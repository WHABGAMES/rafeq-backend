/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Service                              ║
 * ║                                                                                ║
 * ║  ✅ نظام الموظفين الكامل:                                                       ║
 * ║     - دعوة موظف عبر الإيميل (invite token → Redis)                              ║
 * ║     - قبول الدعوة وتعيين كلمة المرور                                            ║
 * ║     - نظام صلاحيات مرن (permissions jsonb)                                     ║
 * ║     - تفعيل/تعطيل الحساب                                                       ║
 * ║     - Audit log لكل العمليات                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { User, UserStatus, UserRole, AuthProvider } from '@database/entities';
import { Tenant } from '@database/entities/tenant.entity';
import { CreateUserDto, UpdateUserDto } from './dto';
import { MailService } from '../mail/mail.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 أنواع الصلاحيات
// ═══════════════════════════════════════════════════════════════════════════════

export interface StaffPermissions {
  conversations: boolean;    // إدارة المحادثات
  contacts: boolean;         // إدارة العملاء
  templates: boolean;        // إدارة القوالب
  campaigns: boolean;        // إدارة الحملات
  automations: boolean;      // إدارة الأتمتة
  analytics: boolean;        // عرض التحليلات
  settings: boolean;         // تعديل الإعدادات
  quickReplies: boolean;     // الردود السريعة
  ai: boolean;               // إعدادات الذكاء الاصطناعي
  // 🔒 محجوزة للـ Owner فقط:
  // billing, stores, staff management
}

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  conversations: true,
  contacts: true,
  templates: false,
  campaigns: false,
  automations: false,
  analytics: false,
  settings: false,
  quickReplies: true,
  ai: false,
};

export const FULL_PERMISSIONS: StaffPermissions = {
  conversations: true,
  contacts: true,
  templates: true,
  campaigns: true,
  automations: true,
  analytics: true,
  settings: true,
  quickReplies: true,
  ai: true,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 Invite Token Constants
// ═══════════════════════════════════════════════════════════════════════════════

const INVITE_TOKEN_PREFIX = 'staff_invite:';
const INVITE_TOKEN_EXPIRY = 72 * 60 * 60; // 72 ساعة
const INVITE_RATE_LIMIT_PREFIX = 'invite_rate:';
const MAX_INVITES_PER_HOUR = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,

    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,

    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 CRUD الأساسي
  // ═══════════════════════════════════════════════════════════════════════════════

  async findAll(tenantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { tenantId },
      order: {
        role: 'ASC',       // Owner أولاً
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: string, tenantId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
    });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async getStats(tenantId: string) {
    const users = await this.findAll(tenantId);
    const stats = {
      total: users.length,
      active: users.filter(u => u.status === UserStatus.ACTIVE).length,
      pending: users.filter(u => u.status === UserStatus.PENDING).length,
      byRole: {} as Record<string, number>,
    };
    for (const role of Object.values(UserRole)) {
      stats.byRole[role] = users.filter(u => u.role === role).length;
    }
    return stats;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📨 دعوة موظف جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  async inviteStaff(
    tenantId: string,
    inviterUser: User,
    dto: { email: string; role?: UserRole; permissions?: Partial<StaffPermissions> },
  ): Promise<{ message: string; inviteId: string }> {
    // ✅ فقط Owner يمكنه دعوة موظفين
    if (inviterUser.role !== UserRole.OWNER) {
      throw new ForbiddenException('فقط صاحب المتجر يمكنه إضافة موظفين');
    }

    const email = dto.email.toLowerCase().trim();

    // ✅ Rate limiting
    const rateLimitKey = `${INVITE_RATE_LIMIT_PREFIX}${tenantId}`;
    const rateCount = await this.redis.get(rateLimitKey);
    if (rateCount && parseInt(rateCount, 10) >= MAX_INVITES_PER_HOUR) {
      throw new BadRequestException('تم تجاوز الحد الأقصى للدعوات. حاول لاحقاً.');
    }

    // ✅ لا يمكن إنشاء Owner آخر
    if (dto.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن إنشاء حساب Owner آخر');
    }

    // ✅ التحقق من عدم وجود المستخدم مسبقاً
    const existing = await this.findByEmail(email);
    if (existing) {
      if (existing.tenantId === tenantId) {
        throw new ConflictException('هذا الموظف موجود بالفعل في متجرك');
      }
      throw new ConflictException('البريد الإلكتروني مسجّل في حساب آخر');
    }

    // ✅ جلب اسم المتجر
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    const storeName = tenant?.name || 'رفيق';

    // ✅ توليد Invite Token
    const inviteToken = crypto.randomBytes(48).toString('hex');
    const inviteTokenHash = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(inviteToken)
      .digest('hex');

    const role = dto.role || UserRole.AGENT;
    const permissions = { ...DEFAULT_STAFF_PERMISSIONS, ...(dto.permissions || {}) };

    // ✅ تخزين في Redis (72 ساعة)
    const inviteData = JSON.stringify({
      email,
      tenantId,
      inviterId: inviterUser.id,
      role,
      permissions,
      storeName,
      createdAt: Date.now(),
    });

    await this.redis.setex(
      `${INVITE_TOKEN_PREFIX}${inviteTokenHash}`,
      INVITE_TOKEN_EXPIRY,
      inviteData,
    );

    // ✅ Rate limit increment
    const rateExists = await this.redis.exists(rateLimitKey);
    if (rateExists) {
      await this.redis.incr(rateLimitKey);
    } else {
      await this.redis.setex(rateLimitKey, 3600, '1');
    }

    // ✅ بناء رابط الدعوة
    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://rafeq.ai');
    const inviteUrl = `${frontendUrl}/auth/accept-invite?token=${inviteToken}&email=${encodeURIComponent(email)}`;

    // ✅ إرسال إيميل الدعوة
    try {
      await this.mailService.sendStaffInviteEmail({
        to: email,
        storeName,
        inviterName: inviterUser.firstName || 'صاحب المتجر',
        role: this.getRoleLabel(role),
        inviteUrl,
      });
      this.logger.log(`✅ Staff invite sent to: ${email} for tenant: ${tenantId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send invite email: ${error instanceof Error ? error.message : 'Unknown'}`);
      // لا نفشل العملية — الرابط محفوظ في Redis
    }

    return {
      message: `تم إرسال دعوة إلى ${email}`,
      inviteId: inviteTokenHash.substring(0, 8), // معرّف مختصر للتتبع
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ قبول الدعوة وتعيين كلمة المرور
  // ═══════════════════════════════════════════════════════════════════════════════

  async acceptInvite(
    token: string,
    email: string,
    password: string,
    name: string,
  ): Promise<{ message: string; userId: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // ✅ Hash token للمقارنة
    const tokenHash = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(token)
      .digest('hex');

    // ✅ جلب بيانات الدعوة من Redis
    const inviteKey = `${INVITE_TOKEN_PREFIX}${tokenHash}`;
    const inviteDataRaw = await this.redis.get(inviteKey);

    if (!inviteDataRaw) {
      throw new BadRequestException('رابط الدعوة غير صالح أو منتهي الصلاحية');
    }

    const inviteData = JSON.parse(inviteDataRaw);

    // ✅ التحقق من تطابق الإيميل
    if (inviteData.email !== normalizedEmail) {
      throw new BadRequestException('البريد الإلكتروني لا يتطابق مع الدعوة');
    }

    // ✅ التحقق من عدم وجود المستخدم مسبقاً (race condition)
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) {
      await this.redis.del(inviteKey);
      throw new ConflictException('البريد الإلكتروني مسجّل بالفعل');
    }

    // ✅ تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 12);
    const nameParts = name.split(' ');

    // ✅ إنشاء المستخدم
    const user = this.userRepository.create({
      tenantId: inviteData.tenantId,
      email: normalizedEmail,
      password: hashedPassword,
      firstName: nameParts[0] || 'موظف',
      lastName: nameParts.slice(1).join(' ') || '',
      role: inviteData.role || UserRole.AGENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      authProvider: AuthProvider.LOCAL,
      preferences: {
        permissions: inviteData.permissions || DEFAULT_STAFF_PERMISSIONS,
        invitedBy: inviteData.inviterId,
        invitedAt: new Date().toISOString(),
      },
    });

    const savedUser = await this.userRepository.save(user);

    // ✅ حذف التوكن (استخدام واحد فقط)
    await this.redis.del(inviteKey);

    this.logger.log(`✅ Staff account created: ${normalizedEmail} → tenant: ${inviteData.tenantId}`);

    return {
      message: 'تم إنشاء حسابك بنجاح! يمكنك الآن تسجيل الدخول.',
      userId: savedUser.id,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ التحقق من صلاحية رابط الدعوة
  // ═══════════════════════════════════════════════════════════════════════════════

  async verifyInviteToken(token: string, email: string): Promise<{
    valid: boolean;
    storeName?: string;
    role?: string;
  }> {
    const tokenHash = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(token)
      .digest('hex');

    const inviteDataRaw = await this.redis.get(`${INVITE_TOKEN_PREFIX}${tokenHash}`);
    if (!inviteDataRaw) {
      return { valid: false };
    }

    const inviteData = JSON.parse(inviteDataRaw);
    if (inviteData.email !== email.toLowerCase().trim()) {
      return { valid: false };
    }

    return {
      valid: true,
      storeName: inviteData.storeName,
      role: this.getRoleLabel(inviteData.role),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 تحديث الصلاحيات
  // ═══════════════════════════════════════════════════════════════════════════════

  async updatePermissions(
    userId: string,
    tenantId: string,
    permissions: Partial<StaffPermissions>,
    updaterRole: UserRole,
  ): Promise<User> {
    if (updaterRole !== UserRole.OWNER) {
      throw new ForbiddenException('فقط صاحب المتجر يمكنه تعديل الصلاحيات');
    }

    const user = await this.findOne(userId, tenantId);

    if (user.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن تعديل صلاحيات صاحب المتجر');
    }

    const currentPrefs = user.preferences || {};
    const currentPerms = (currentPrefs.permissions as StaffPermissions) || DEFAULT_STAFF_PERMISSIONS;

    user.preferences = {
      ...currentPrefs,
      permissions: { ...currentPerms, ...permissions },
      lastPermissionUpdate: new Date().toISOString(),
    };

    return this.userRepository.save(user);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 تفعيل/تعطيل حساب
  // ═══════════════════════════════════════════════════════════════════════════════

  async toggleStatus(
    userId: string,
    tenantId: string,
    updaterRole: UserRole,
  ): Promise<User> {
    if (updaterRole !== UserRole.OWNER) {
      throw new ForbiddenException('فقط صاحب المتجر يمكنه تفعيل/تعطيل الحسابات');
    }

    const user = await this.findOne(userId, tenantId);

    if (user.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن تعطيل حساب صاحب المتجر');
    }

    user.status = user.status === UserStatus.ACTIVE
      ? UserStatus.INACTIVE
      : UserStatus.ACTIVE;

    return this.userRepository.save(user);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ➕ إنشاء مستخدم (الـ CRUD القديم — يبقى للتوافقية)
  // ═══════════════════════════════════════════════════════════════════════════════

  async create(tenantId: string, dto: CreateUserDto, creatorRole: UserRole): Promise<User> {
    if (creatorRole === UserRole.AGENT || creatorRole === UserRole.MARKETING) {
      throw new ForbiddenException('ليس لديك صلاحية إضافة مستخدمين');
    }
    if (dto.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن إنشاء owner آخر');
    }
    if (dto.role === UserRole.MANAGER && creatorRole !== UserRole.OWNER) {
      throw new ForbiddenException('Owner فقط يمكنه إضافة مدير');
    }

    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('البريد الإلكتروني مستخدم مسبقاً');
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = this.userRepository.create({
      tenantId,
      email: dto.email.toLowerCase(),
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      role: dto.role || UserRole.AGENT,
      status: UserStatus.PENDING,
      preferences: {
        permissions: DEFAULT_STAFF_PERMISSIONS,
      },
    });

    return this.userRepository.save(user);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✏️ تحديث مستخدم
  // ═══════════════════════════════════════════════════════════════════════════════

  async update(id: string, tenantId: string, dto: UpdateUserDto, updaterRole: UserRole): Promise<User> {
    const user = await this.findOne(id, tenantId);

    if (user.role === UserRole.OWNER && dto.role && dto.role !== UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن تغيير دور صاحب المتجر');
    }
    if (dto.role === UserRole.MANAGER && updaterRole !== UserRole.OWNER) {
      throw new ForbiddenException('Owner فقط يمكنه ترقية لمدير');
    }

    Object.assign(user, {
      firstName: dto.firstName ?? user.firstName,
      lastName: dto.lastName ?? user.lastName,
      phone: dto.phone ?? user.phone,
      role: dto.role ?? user.role,
      status: dto.status ?? user.status,
    });

    return this.userRepository.save(user);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🗑️ حذف مستخدم
  // ═══════════════════════════════════════════════════════════════════════════════

  async remove(id: string, tenantId: string, deleterRole: UserRole): Promise<void> {
    const user = await this.findOne(id, tenantId);

    if (user.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن حذف صاحب المتجر');
    }
    if (deleterRole !== UserRole.OWNER) {
      throw new ForbiddenException('فقط صاحب المتجر يمكنه حذف الموظفين');
    }

    await this.userRepository.softDelete(id);
    this.logger.log(`🗑️ Staff removed: ${user.email} from tenant: ${tenantId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private getRoleLabel(role: UserRole): string {
    const labels: Record<string, string> = {
      [UserRole.OWNER]: 'صاحب المتجر',
      [UserRole.MANAGER]: 'مدير',
      [UserRole.AGENT]: 'موظف دعم',
      [UserRole.MARKETING]: 'تسويق',
    };
    return labels[role] || 'موظف';
  }
}
