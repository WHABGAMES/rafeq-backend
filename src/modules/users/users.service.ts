/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Service                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import { User, UserStatus, UserRole } from '@database/entities';
import { CreateUserDto, UpdateUserDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * 📋 جلب كل المستخدمين في المتجر
   */
  async findAll(tenantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 🔍 جلب مستخدم معين
   */
  async findOne(id: string, tenantId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    return user;
  }

  /**
   * 🔍 جلب مستخدم بالبريد الإلكتروني
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  /**
   * ➕ إنشاء مستخدم جديد (دعوة موظف)
   */
  async create(tenantId: string, dto: CreateUserDto, creatorRole: UserRole): Promise<User> {
    // التحقق من الصلاحيات
    if (creatorRole === UserRole.AGENT || creatorRole === UserRole.MARKETING) {
      throw new ForbiddenException('ليس لديك صلاحية إضافة مستخدمين');
    }

    // Owner فقط يمكنه إنشاء Manager
    if (dto.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن إنشاء owner آخر');
    }

    if (dto.role === UserRole.MANAGER && creatorRole !== UserRole.OWNER) {
      throw new ForbiddenException('Owner فقط يمكنه إضافة مدير');
    }

    // التحقق من عدم وجود البريد مسبقاً
    const existing = await this.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('البريد الإلكتروني مستخدم مسبقاً');
    }

    // إنشاء كلمة مرور مؤقتة
    const tempPassword = nanoid(12);
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // إنشاء المستخدم
    const user = this.userRepository.create({
      tenantId,
      email: dto.email.toLowerCase(),
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      role: dto.role || UserRole.AGENT,
      status: UserStatus.PENDING, // ينتظر تفعيل البريد
    });

    const savedUser = await this.userRepository.save(user);

    // TODO: إرسال بريد دعوة مع كلمة المرور المؤقتة

    return savedUser;
  }

  /**
   * ✏️ تحديث مستخدم
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateUserDto,
    updaterRole: UserRole,
  ): Promise<User> {
    const user = await this.findOne(id, tenantId);

    // لا يمكن تغيير دور الـ Owner
    if (user.role === UserRole.OWNER && dto.role && dto.role !== UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن تغيير دور صاحب المتجر');
    }

    // فقط Owner يمكنه تغيير الأدوار لـ Manager
    if (dto.role === UserRole.MANAGER && updaterRole !== UserRole.OWNER) {
      throw new ForbiddenException('Owner فقط يمكنه ترقية لمدير');
    }

    // تحديث البيانات
    Object.assign(user, {
      firstName: dto.firstName ?? user.firstName,
      lastName: dto.lastName ?? user.lastName,
      phone: dto.phone ?? user.phone,
      role: dto.role ?? user.role,
      status: dto.status ?? user.status,
    });

    return this.userRepository.save(user);
  }

  /**
   * 🗑️ حذف مستخدم (Soft Delete)
   */
  async remove(id: string, tenantId: string, deleterRole: UserRole): Promise<void> {
    const user = await this.findOne(id, tenantId);

    // لا يمكن حذف الـ Owner
    if (user.role === UserRole.OWNER) {
      throw new ForbiddenException('لا يمكن حذف صاحب المتجر');
    }

    // فقط Owner و Manager يمكنهم الحذف
    if (deleterRole === UserRole.AGENT || deleterRole === UserRole.MARKETING) {
      throw new ForbiddenException('ليس لديك صلاحية حذف مستخدمين');
    }

    // Soft delete
    await this.userRepository.softDelete(id);
  }

  /**
   * 📊 إحصائيات المستخدمين
   */
  async getStats(tenantId: string): Promise<{
    total: number;
    active: number;
    byRole: Record<string, number>;
  }> {
    const users = await this.findAll(tenantId);

    const stats = {
      total: users.length,
      active: users.filter(u => u.status === UserStatus.ACTIVE).length,
      byRole: {} as Record<string, number>,
    };

    // حساب العدد حسب الدور
    for (const role of Object.values(UserRole)) {
      stats.byRole[role] = users.filter(u => u.role === role).length;
    }

    return stats;
  }
}
