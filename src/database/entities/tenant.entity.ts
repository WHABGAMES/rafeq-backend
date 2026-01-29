/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Tenant Entity                              ║
 * ║                                                                                ║
 * ║  📌 الـ Tenant = المتجر/الشركة التي تستخدم المنصة                                ║
 * ║                                                                                ║
 * ║  Multi-tenancy يعني:                                                           ║
 * ║  - كل متجر له بياناته المنفصلة                                                  ║
 * ║  - لا يمكن لمتجر الوصول لبيانات متجر آخر                                        ║
 * ║  - كل الـ entities الأخرى مرتبطة بـ Tenant                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * 📌 حالة الـ Tenant
 */
export enum TenantStatus {
  ACTIVE = 'active',           // نشط
  TRIAL = 'trial',             // فترة تجريبية
  INACTIVE = 'inactive',       // غير نشط
  SUSPENDED = 'suspended',     // موقوف
  PENDING = 'pending',         // قيد التفعيل
}

/**
 * 📌 خطة الاشتراك
 */
export enum SubscriptionPlan {
  FREE = 'free',
  BASIC = 'basic',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Entity('tenants')
export class Tenant extends BaseEntity {
  /**
   * 🏷️ اسم المتجر
   */
  @Column({
    type: 'varchar',
    length: 255,
  })
  name: string;

  /**
   * 🔗 Slug (للـ URL)
   * مثال: my-store → my-store.rafiq.com
   */
  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  @Index('idx_tenant_slug')
  slug: string;

  /**
   * 📧 البريد الإلكتروني
   */
  @Column({
    type: 'varchar',
    length: 255,
    unique: true,
  })
  @Index('idx_tenant_email')
  email: string;

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
   * 🖼️ الشعار
   */
  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  logo?: string;

  /**
   * 🌐 الموقع الإلكتروني
   */
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  website?: string;

  /**
   * 📊 حالة الـ Tenant
   */
  @Column({
    type: 'enum',
    enum: TenantStatus,
    default: TenantStatus.PENDING,
  })
  @Index('idx_tenant_status')
  status: TenantStatus;

  /**
   * 💰 خطة الاشتراك
   */
  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    default: SubscriptionPlan.FREE,
  })
  subscriptionPlan: SubscriptionPlan;

  /**
   * 📅 تاريخ انتهاء الاشتراك
   */
  @Column({
    name: 'subscription_ends_at',
    type: 'timestamptz',
    nullable: true,
  })
  subscriptionEndsAt?: Date;

  /**
   * 📅 تاريخ انتهاء الفترة التجريبية
   */
  @Column({
    name: 'trial_ends_at',
    type: 'timestamptz',
    nullable: true,
  })
  trialEndsAt?: Date;

  /**
   * 🌍 المنطقة الزمنية
   */
  @Column({
    type: 'varchar',
    length: 50,
    default: 'Asia/Riyadh',
  })
  timezone: string;

  /**
   * 🌐 اللغة الافتراضية
   */
  @Column({
    name: 'default_language',
    type: 'varchar',
    length: 10,
    default: 'ar',
  })
  defaultLanguage: string;

  /**
   * 💵 العملة
   */
  @Column({
    type: 'varchar',
    length: 3,
    default: 'SAR',
  })
  currency: string;

  /**
   * 📊 الحد الشهري للرسائل
   */
  @Column({
    name: 'monthly_message_limit',
    type: 'integer',
    default: 1000,
  })
  monthlyMessageLimit: number;

  /**
   * ⚙️ إعدادات الـ Tenant (JSON)
   * 
   * مثال:
   * {
   *   "timezone": "Asia/Riyadh",
   *   "language": "ar",
   *   "currency": "SAR",
   *   "workingHours": { "start": "09:00", "end": "21:00" }
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  settings: Record<string, unknown>;

  /**
   * 🔒 إعدادات الذكاء الاصطناعي
   * 
   * {
   *   "tone": "friendly",
   *   "autoReply": true,
   *   "handoffThreshold": 3,
   *   "verificationRequired": true
   * }
   */
  @Column({
    name: 'ai_settings',
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  aiSettings: Record<string, unknown>;

  /**
   * 📊 حدود الاستخدام
   * 
   * {
   *   "maxMessages": 10000,
   *   "maxAgents": 5,
   *   "maxChannels": 3
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  limits: Record<string, number>;

  /**
   * 📈 إحصائيات الاستخدام الشهري
   * 
   * {
   *   "messagesCount": 5000,
   *   "conversationsCount": 800,
   *   "aiCallsCount": 2000
   * }
   */
  @Column({
    name: 'monthly_usage',
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  monthlyUsage: Record<string, number>;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 RELATIONS (العلاقات)
  // سيتم تعريفها لاحقاً مع الـ entities الأخرى
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // @OneToMany(() => User, user => user.tenant)
  // users: User[];

  // @OneToMany(() => Store, store => store.tenant)
  // stores: Store[];

  // @OneToMany(() => Channel, channel => channel.tenant)
  // channels: Channel[];
}

/**
 * 📌 مثال على الجدول الناتج:
 * 
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                          tenants                               │
 * ├─────────────────────┬──────────────┬───────────────────────────┤
 * │ id                  │ uuid         │ PRIMARY KEY               │
 * │ name                │ varchar(255) │                           │
 * │ slug                │ varchar(100) │ UNIQUE, INDEX             │
 * │ email               │ varchar(255) │ UNIQUE, INDEX             │
 * │ phone               │ varchar(20)  │ NULL                      │
 * │ logo                │ varchar(500) │ NULL                      │
 * │ website             │ varchar(255) │ NULL                      │
 * │ status              │ enum         │ INDEX                     │
 * │ subscription_plan   │ enum         │                           │
 * │ subscription_ends_at│ timestamptz  │ NULL                      │
 * │ settings            │ jsonb        │                           │
 * │ ai_settings         │ jsonb        │                           │
 * │ limits              │ jsonb        │                           │
 * │ monthly_usage       │ jsonb        │                           │
 * │ created_at          │ timestamptz  │                           │
 * │ updated_at          │ timestamptz  │                           │
 * │ deleted_at          │ timestamptz  │ NULL                      │
 * └─────────────────────┴──────────────┴───────────────────────────┘
 */
