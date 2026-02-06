/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - User Entity                                ║
 * ║                                                                                ║
 * ║  📌 المستخدم = الموظف الذي يعمل في المتجر                                        ║
 * ║                                                                                ║
 * ║  أنواع المستخدمين:                                                              ║
 * ║  - Owner: صاحب المتجر (كل الصلاحيات)                                            ║
 * ║  - Manager: مدير (معظم الصلاحيات)                                               ║
 * ║  - Agent: موظف دعم (صلاحيات محدودة)                                             ║
 * ║  - Marketing: موظف تسويق                                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

/**
 * 📌 أدوار المستخدم
 */
export enum UserRole {
  OWNER = 'owner',           // صاحب المتجر
  MANAGER = 'manager',       // مدير
  AGENT = 'agent',           // موظف دعم
  MARKETING = 'marketing',   // موظف تسويق
}

/**
 * 📌 حالة المستخدم
 */
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',       // في انتظار تفعيل البريد
}

/**
 * 📌 مزود المصادقة
 * طريقة تسجيل الدخول المستخدمة
 */
export enum AuthProvider {
  LOCAL = 'local',           // إيميل + باسورد
  GOOGLE = 'google',         // Google OAuth
  SALLA = 'salla',           // منصة سلة
  ZID = 'zid',               // منصة زد
  OTP = 'otp',               // رمز تحقق عبر الإيميل
}

@Entity('users')
export class User extends BaseEntity {
  /**
   * 🏢 الـ Tenant (المتجر)
   * 
   * كل مستخدم ينتمي لمتجر واحد
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_user_tenant')
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * 📧 البريد الإلكتروني
   * فريد على مستوى كل الـ tenants
   */
  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
  })
  @Index('idx_user_email')
  email: string;

  /**
   * 🔒 كلمة المرور (مشفرة)
   * nullable للمستخدمين عبر OAuth أو OTP
   */
  @Column({
    type: 'varchar',
    length: 255,
    select: false,
    nullable: true,
  })
  password?: string;

  /**
   * 👤 الاسم الأول
   */
  @Column({
    name: 'first_name',
    type: 'varchar',
    length: 100,
  })
  firstName: string;

  /**
   * 👤 الاسم الأخير
   */
  @Column({
    name: 'last_name',
    type: 'varchar',
    length: 100,
  })
  lastName: string;

  /**
   * 📱 رقم الهاتف
   */
  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  phone?: string;

  /**
   * 🖼️ صورة الملف الشخصي
   */
  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  avatar?: string;

  /**
   * 👔 الدور
   */
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.AGENT,
  })
  @Index('idx_user_role')
  role: UserRole;

  /**
   * 📊 الحالة
   */
  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  @Index('idx_user_status')
  status: UserStatus;

  /**
   * ✅ هل تم تأكيد البريد؟
   */
  @Column({
    name: 'email_verified',
    type: 'boolean',
    default: false,
  })
  emailVerified: boolean;

  /**
   * 📅 تاريخ آخر تسجيل دخول
   */
  @Column({
    name: 'last_login_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastLoginAt?: Date;

  /**
   * 🔑 Refresh Token (للتحديث التلقائي)
   */
  @Column({
    name: 'refresh_token',
    type: 'varchar',
    length: 500,
    nullable: true,
    select: false,
  })
  refreshToken?: string;

  /**
   * 🔐 مزود المصادقة (طريقة التسجيل)
   */
  @Column({
    name: 'auth_provider',
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.LOCAL,
  })
  @Index('idx_user_auth_provider')
  authProvider: AuthProvider;

  /**
   * 🆔 معرّف المستخدم عند المزود الخارجي
   * مثال: Google sub, Salla merchant_id, Zid merchant_id
   */
  @Column({
    name: 'provider_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Index('idx_user_provider_id')
  providerId?: string;

  /**
   * 🖼️ صورة من المزود الخارجي (Google avatar, etc)
   */
  @Column({
    name: 'provider_avatar',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  providerAvatar?: string;

  /**
   * ⚙️ تفضيلات المستخدم
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  preferences: Record<string, unknown>;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 HOOKS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ⚠️ ملاحظة مهمة:
   * التشفير يتم في AuthService يدوياً قبل الحفظ
   * لا نستخدم @BeforeInsert/@BeforeUpdate لتجنب التشفير المزدوج
   * 
   * السبب: إذا شفّرنا هنا + في Service = الباسورد يتشفّر مرتين
   * والمستخدم ما يقدر يسجل دخول أبداً
   */

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من كلمة المرور
   */
  async validatePassword(password: string): Promise<boolean> {
    if (!this.password) return false;
    return bcrypt.compare(password, this.password);
  }

  /**
   * الاسم الكامل
   */
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
