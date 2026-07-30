/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Service                              ║
 * ║                                                                                ║
 * ║  ✅ نظام الموظفين الكامل:                                                       ║
 * ║     - دعوة موظف عبر الإيميل (invite token → Database)                           ║
 * ║     - قبول الدعوة وتعيين كلمة المرور                                            ║
 * ║     - نظام صلاحيات مرن (permissions jsonb)                                     ║
 * ║     - تفعيل/تعطيل الحساب                                                       ║
 * ║                                                                                ║
 * ║  ⚡ يعتمد على Database فقط — لا يحتاج Redis                                     ║
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
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { hashPassword } from '@common/utils/password.util';
import * as crypto from 'crypto';

import { User, UserStatus, UserRole, AuthProvider } from '@database/entities';
import { Tenant } from '@database/entities/tenant.entity';
import { CreateUserDto, UpdateUserDto } from './dto';
import { MailService } from '../mail/mail.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 أنواع الصلاحيات
// ═══════════════════════════════════════════════════════════════════════════════

export interface StaffPermissions {
  conversations: boolean;
  contacts: boolean;
  templates: boolean;
  campaigns: boolean;
  analytics: boolean;
  settings: boolean;
  quickReplies: boolean;
  ai: boolean;
}

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  conversations: true,
  contacts: true,
  templates: false,
  campaigns: false,
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
  analytics: true,
  settings: true,
  quickReplies: true,
  ai: true,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 Constants
// ═══════════════════════════════════════════════════════════════════════════════

const INVITE_TOKEN_EXPIRY_HOURS = 72;
const MAX_INVITES_PER_HOUR = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,

    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 CRUD الأساسي
  // ═══════════════════════════════════════════════════════════════════════════════

  async findAll(tenantId: string): Promise<User[]> {
    const users = await this.userRepository.find({
      where: { tenantId },
      order: {
        role: 'ASC',
        createdAt: 'DESC',
      },
    });

    // ✅ إزالة بيانات الدعوة الحساسة من الاستجابة
    return users.map(user => {
      if (user.preferences?.invite) {
        const { invite, ...cleanPrefs } = user.preferences as any;
        user.preferences = cleanPrefs;
      }
      return user;
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
  // 📨 دعوة موظف جديد (Database-based — لا يحتاج Redis)
  // ═══════════════════════════════════════════════════════════════════════════════

  async inviteStaff(
    tenantId: string,
    inviterUser: User,
    dto: { email: string; role?: UserRole; permissions?: Partial<StaffPermissions> },
  ): Promise<{ message: string; inviteId: string }> {
    if (inviterUser.role !== UserRole.OWNER) {
      throw new ForbiddenException('فقط صاحب المتجر يمكنه إضافة موظفين');
    }

    const email = dto.email.toLowerCase().trim();

    if (dto.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن إنشاء حساب Owner آخر');
    }

    // ✅ Rate limiting عبر Database
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentInvites = await this.userRepository.count({
      where: {
        tenantId,
        status: UserStatus.PENDING,
        createdAt: MoreThan(oneHourAgo),
      },
    });
    if (recentInvites >= MAX_INVITES_PER_HOUR) {
      throw new BadRequestException('تم تجاوز الحد الأقصى للدعوات. حاول لاحقاً.');
    }

    // ✅ التحقق من عدم وجود المستخدم مسبقاً
    const existing = await this.findByEmail(email);
    if (existing) {
      if (existing.tenantId === tenantId && existing.status === UserStatus.PENDING) {
        return this.resendInvite(existing, inviterUser);
      }
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
    const inviteTokenHash = this.hashToken(inviteToken);

    const role = dto.role || UserRole.AGENT;
    const permissions = { ...DEFAULT_STAFF_PERMISSIONS, ...(dto.permissions || {}) };

    // ✅ إنشاء المستخدم بحالة PENDING مع بيانات الدعوة في preferences
    const user = this.userRepository.create({
      tenantId,
      email,
      firstName: 'موظف',
      lastName: 'جديد',
      role,
      status: UserStatus.PENDING,
      emailVerified: false,
      authProvider: AuthProvider.LOCAL,
      preferences: {
        permissions,
        invite: {
          tokenHash: inviteTokenHash,
          inviterId: inviterUser.id,
          storeName,
          expiresAt: new Date(Date.now() + INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      },
    });

    const savedUser = await this.userRepository.save(user);

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
    }

    return {
      message: `تم إرسال دعوة إلى ${email}`,
      inviteId: savedUser.id.substring(0, 8),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 إعادة إرسال الدعوة
  // ═══════════════════════════════════════════════════════════════════════════════

  private async resendInvite(
    pendingUser: User,
    inviterUser: User,
  ): Promise<{ message: string; inviteId: string }> {
    const invitePrefs = pendingUser.preferences?.invite as any;
    const storeName = invitePrefs?.storeName || 'رفيق';

    const inviteToken = crypto.randomBytes(48).toString('hex');
    const inviteTokenHash = this.hashToken(inviteToken);

    pendingUser.preferences = {
      ...pendingUser.preferences,
      invite: {
        tokenHash: inviteTokenHash,
        inviterId: inviterUser.id,
        storeName,
        expiresAt: new Date(Date.now() + INVITE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    };

    await this.userRepository.save(pendingUser);

    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://rafeq.ai');
    const inviteUrl = `${frontendUrl}/auth/accept-invite?token=${inviteToken}&email=${encodeURIComponent(pendingUser.email)}`;

    try {
      await this.mailService.sendStaffInviteEmail({
        to: pendingUser.email,
        storeName,
        inviterName: inviterUser.firstName || 'صاحب المتجر',
        role: this.getRoleLabel(pendingUser.role),
        inviteUrl,
      });
      this.logger.log(`✅ Staff invite re-sent to: ${pendingUser.email}`);
    } catch (error) {
      this.logger.error(`❌ Failed to resend invite email: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    return {
      message: `تم إعادة إرسال الدعوة إلى ${pendingUser.email}`,
      inviteId: pendingUser.id.substring(0, 8),
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
    const tokenHash = this.hashToken(token);

    const pendingUser = await this.userRepository.findOne({
      where: {
        email: normalizedEmail,
        status: UserStatus.PENDING,
      },
    });

    if (!pendingUser) {
      throw new BadRequestException('رابط الدعوة غير صالح أو منتهي الصلاحية');
    }

    const inviteData = pendingUser.preferences?.invite as any;
    if (!inviteData || !inviteData.tokenHash) {
      throw new BadRequestException('رابط الدعوة غير صالح');
    }

    if (inviteData.tokenHash !== tokenHash) {
      throw new BadRequestException('رابط الدعوة غير صالح');
    }

    if (new Date(inviteData.expiresAt) < new Date()) {
      throw new BadRequestException('رابط الدعوة منتهي الصلاحية. اطلب دعوة جديدة.');
    }

    const hashedPassword = await hashPassword(password);
    const nameParts = name.split(' ');

    pendingUser.password = hashedPassword;
    pendingUser.firstName = nameParts[0] || 'موظف';
    pendingUser.lastName = nameParts.slice(1).join(' ') || '';
    pendingUser.status = UserStatus.ACTIVE;
    pendingUser.emailVerified = true;

    const permissions = pendingUser.preferences?.permissions || DEFAULT_STAFF_PERMISSIONS;
    pendingUser.preferences = {
      permissions,
      invitedBy: inviteData.inviterId,
      invitedAt: inviteData.createdAt,
      activatedAt: new Date().toISOString(),
    };

    const savedUser = await this.userRepository.save(pendingUser);

    this.logger.log(`✅ Staff account activated: ${normalizedEmail} → tenant: ${pendingUser.tenantId}`);

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
    const tokenHash = this.hashToken(token);
    const normalizedEmail = email.toLowerCase().trim();

    const pendingUser = await this.userRepository.findOne({
      where: {
        email: normalizedEmail,
        status: UserStatus.PENDING,
      },
    });

    if (!pendingUser) {
      return { valid: false };
    }

    const inviteData = pendingUser.preferences?.invite as any;
    if (!inviteData || inviteData.tokenHash !== tokenHash) {
      return { valid: false };
    }

    if (new Date(inviteData.expiresAt) < new Date()) {
      return { valid: false };
    }

    return {
      valid: true,
      storeName: inviteData.storeName,
      role: this.getRoleLabel(pendingUser.role),
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
    const hashedPassword = await hashPassword(tempPassword);

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

  private hashToken(token: string): string {
    return crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(token)
      .digest('hex');
  }

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
