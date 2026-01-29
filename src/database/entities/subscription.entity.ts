/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Subscription Entity                        ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Entity يمثل اشتراك المستأجر في خطة معينة                          ║
 * ║                                                                                ║
 * ║  Tenant ←→ Subscription ←→ SubscriptionPlan                                   ║
 * ║                                                                                ║
 * ║  كل Tenant له اشتراك واحد نشط في أي وقت                                       ║
 * ║  لكن نحتفظ بتاريخ الاشتراكات السابقة                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🏷️ TYPES & ENUMS                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/**
 * 📌 SubscriptionStatus - حالة الاشتراك
 */
export enum SubscriptionStatus {
  /** تجريبي */
  TRIALING = 'trialing',
  /** نشط */
  ACTIVE = 'active',
  /** متأخر الدفع (grace period) */
  PAST_DUE = 'past_due',
  /** معلق (بسبب عدم الدفع) */
  SUSPENDED = 'suspended',
  /** ملغي (سيُلغى في نهاية الفترة) */
  CANCELLING = 'cancelling',
  /** ملغي */
  CANCELLED = 'cancelled',
  /** منتهي */
  EXPIRED = 'expired',
}

/**
 * 📌 BillingInterval - فترة الفوترة
 */
export enum BillingInterval {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  SEMI_ANNUAL = 'semi_annual',
  YEARLY = 'yearly',
}

/**
 * 📌 PaymentProvider - مزود الدفع
 */
export enum PaymentProvider {
  /** Stripe */
  STRIPE = 'stripe',
  /** Moyasar */
  MOYASAR = 'moyasar',
  /** تحويل بنكي */
  BANK_TRANSFER = 'bank_transfer',
  /** يدوي */
  MANUAL = 'manual',
}

/**
 * 📌 UsageStats - إحصائيات الاستخدام
 */
export interface UsageStats {
  /** الرسائل المستخدمة هذا الشهر */
  messagesUsed: number;
  /** حد الرسائل */
  messagesLimit: number;
  /** المتاجر المتصلة */
  storesCount: number;
  /** حد المتاجر */
  storesLimit: number;
  /** المستخدمين */
  usersCount: number;
  /** حد المستخدمين */
  usersLimit: number;
  /** التخزين المستخدم (MB) */
  storageUsed: number;
  /** حد التخزين */
  storageLimit: number;
  /** آخر تحديث */
  lastUpdated: string;
}

/**
 * 📌 BillingInfo - معلومات الفوترة
 */
export interface BillingInfo {
  /** اسم الشركة */
  companyName?: string;
  /** الرقم الضريبي */
  taxId?: string;
  /** البريد الإلكتروني للفواتير */
  billingEmail?: string;
  /** العنوان */
  address?: {
    street?: string;
    city?: string;
    country?: string;
    postalCode?: string;
  };
}

/**
 * 📌 PaymentMethod - طريقة الدفع المحفوظة
 */
export interface PaymentMethod {
  /** المعرف في مزود الدفع */
  providerId: string;
  /** النوع (بطاقة، مدى، إلخ) */
  type: string;
  /** آخر 4 أرقام (للبطاقات) */
  last4?: string;
  /** العلامة التجارية */
  brand?: string;
  /** تاريخ الانتهاء */
  expiryDate?: string;
  /** هل هي الافتراضية */
  isDefault: boolean;
}

/**
 * 📌 SubscriptionMetadata - بيانات إضافية
 */
export interface SubscriptionMetadata {
  /** معرف العميل في Stripe */
  stripeCustomerId?: string;
  /** معرف الاشتراك في Stripe */
  stripeSubscriptionId?: string;
  /** معرف العميل في Moyasar */
  moyasarCustomerId?: string;
  /** كود الخصم المستخدم */
  discountCode?: string;
  /** نسبة الخصم */
  discountPercent?: number;
  /** ملاحظات */
  notes?: string;
  /** سبب الإلغاء */
  cancellationReason?: string;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🗃️ SUBSCRIPTION ENTITY                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
@Entity('subscriptions')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'currentPeriodEnd'])
@Index(['status'])
export class Subscription extends BaseEntity {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔑 IDENTIFIERS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🏢 Tenant ID
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /**
   * 📋 Plan ID
   */
  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📊 STATUS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🚦 Status - حالة الاشتراك
   */
  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.TRIALING,
    comment: 'حالة الاشتراك',
  })
  status: SubscriptionStatus;

  /**
   * 📅 Billing Interval - فترة الفوترة
   */
  @Column({
    name: 'billing_interval',
    type: 'enum',
    enum: BillingInterval,
    default: BillingInterval.MONTHLY,
    comment: 'فترة الفوترة',
  })
  billingInterval: BillingInterval;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📅 DATES
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📅 Started At - تاريخ بدء الاشتراك
   */
  @Column({
    name: 'started_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ بدء الاشتراك',
  })
  startedAt?: Date;

  /**
   * 📅 Trial Ends At - تاريخ انتهاء التجربة
   */
  @Column({
    name: 'trial_ends_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ انتهاء الفترة التجريبية',
  })
  trialEndsAt?: Date;

  /**
   * 📅 Current Period Start - بداية الفترة الحالية
   */
  @Column({
    name: 'current_period_start',
    type: 'timestamptz',
    nullable: true,
    comment: 'بداية فترة الفوترة الحالية',
  })
  currentPeriodStart?: Date;

  /**
   * 📅 Current Period End - نهاية الفترة الحالية
   * 
   * هذا التاريخ مهم جداً:
   * - يحدد متى يجب تجديد الاشتراك
   * - يحدد متى ينتهي الاشتراك إذا لم يُجدد
   */
  @Column({
    name: 'current_period_end',
    type: 'timestamptz',
    nullable: true,
    comment: 'نهاية فترة الفوترة الحالية',
  })
  currentPeriodEnd?: Date;

  /**
   * 📅 Cancelled At - تاريخ طلب الإلغاء
   */
  @Column({
    name: 'cancelled_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ طلب الإلغاء',
  })
  cancelledAt?: Date;

  /**
   * 📅 Ends At - تاريخ انتهاء الاشتراك
   * 
   * إذا تم الإلغاء، هذا هو التاريخ الفعلي للانتهاء
   * (عادة نهاية الفترة المدفوعة)
   */
  @Column({
    name: 'ends_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ انتهاء الاشتراك الفعلي',
  })
  endsAt?: Date;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              💰 PRICING
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 💵 Currency - العملة
   */
  @Column({
    type: 'varchar',
    length: 5,
    default: 'SAR',
    comment: 'العملة',
  })
  currency: string;

  /**
   * 💰 Amount - المبلغ للفترة
   */
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'المبلغ للفترة',
  })
  amount: number;

  /**
   * 🏷️ Discount Amount - قيمة الخصم
   */
  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'قيمة الخصم',
  })
  discountAmount: number;

  /**
   * 💲 Tax Amount - الضريبة
   */
  @Column({
    name: 'tax_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'قيمة الضريبة',
  })
  taxAmount: number;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              💳 PAYMENT
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 💳 Payment Provider - مزود الدفع
   */
  @Column({
    name: 'payment_provider',
    type: 'enum',
    enum: PaymentProvider,
    nullable: true,
    comment: 'مزود الدفع',
  })
  paymentProvider?: PaymentProvider;

  /**
   * 💳 Payment Methods - طرق الدفع المحفوظة
   */
  @Column({
    name: 'payment_methods',
    type: 'jsonb',
    default: [],
    comment: 'طرق الدفع المحفوظة',
  })
  paymentMethods: PaymentMethod[];

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📊 USAGE
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📊 Usage Stats - إحصائيات الاستخدام
   * 
   * تُحدّث دورياً (كل ساعة مثلاً)
   */
  @Column({
    name: 'usage_stats',
    type: 'jsonb',
    default: {
      messagesUsed: 0,
      messagesLimit: 0,
      storesCount: 0,
      storesLimit: 0,
      usersCount: 0,
      usersLimit: 0,
      storageUsed: 0,
      storageLimit: 0,
      lastUpdated: null,
    },
    comment: 'إحصائيات الاستخدام',
  })
  usageStats: UsageStats;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📝 BILLING INFO
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📝 Billing Info - معلومات الفوترة
   */
  @Column({
    name: 'billing_info',
    type: 'jsonb',
    nullable: true,
    comment: 'معلومات الفوترة',
  })
  billingInfo?: BillingInfo;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              ⚙️ SETTINGS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🔄 Auto Renew - التجديد التلقائي
   */
  @Column({
    name: 'auto_renew',
    type: 'boolean',
    default: true,
    comment: 'هل يتجدد تلقائياً',
  })
  autoRenew: boolean;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📝 METADATA
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📝 Metadata
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
    comment: 'بيانات إضافية',
  })
  metadata: SubscriptionMetadata;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔗 RELATIONS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => SubscriptionPlan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         📚 SUBSCRIPTION LIFECYCLE                              ║
 * ╠═══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                                ║
 * ║  🔄 دورة حياة الاشتراك:                                                        ║
 * ║  ════════════════════════                                                      ║
 * ║                                                                                ║
 * ║  ┌───────────────────────────────────────────────────────────────────────┐    ║
 * ║  │                           التسجيل الجديد                             │    ║
 * ║  └───────────────────────────────────────────────────────────────────────┘    ║
 * ║                                   │                                           ║
 * ║                                   ▼                                           ║
 * ║  ┌───────────────────────────────────────────────────────────────────────┐    ║
 * ║  │  TRIALING (تجريبي)                                                    │    ║
 * ║  │  • 14 يوم مجاناً                                                      │    ║
 * ║  │  • كل الميزات متاحة                                                   │    ║
 * ║  │  • لا يُطلب بطاقة دفع                                                │    ║
 * ║  └───────────────────────────────────────────────────────────────────────┘    ║
 * ║                    │                              │                           ║
 * ║           أضاف بطاقة دفع                    انتهت التجربة                     ║
 * ║                    │                         (بدون دفع)                       ║
 * ║                    ▼                              ▼                           ║
 * ║  ┌────────────────────────────┐   ┌────────────────────────────┐             ║
 * ║  │  ACTIVE (نشط)              │   │  EXPIRED (منتهي)           │             ║
 * ║  │  • يُخصم المبلغ تلقائياً   │   │  • لا يمكن استخدام المنصة  │             ║
 * ║  │  • كل الميزات متاحة        │   │  • البيانات محفوظة          │             ║
 * ║  └────────────────────────────┘   └────────────────────────────┘             ║
 * ║              │         │                                                      ║
 * ║        فشل الدفع    طلب إلغاء                                                ║
 * ║              │         │                                                      ║
 * ║              ▼         ▼                                                      ║
 * ║  ┌──────────────┐ ┌──────────────┐                                           ║
 * ║  │  PAST_DUE    │ │  CANCELLING  │                                           ║
 * ║  │  (متأخر)    │ │  (قيد الإلغاء)│                                           ║
 * ║  │  • 7 أيام    │ │  • يعمل حتى  │                                           ║
 * ║  │    للدفع    │ │    نهاية     │                                           ║
 * ║  └──────────────┘ │    الفترة   │                                           ║
 * ║        │          └──────────────┘                                           ║
 * ║        │                 │                                                    ║
 * ║   لم يدفع           انتهت الفترة                                             ║
 * ║        │                 │                                                    ║
 * ║        ▼                 ▼                                                    ║
 * ║  ┌──────────────┐ ┌──────────────┐                                           ║
 * ║  │  SUSPENDED   │ │  CANCELLED   │                                           ║
 * ║  │  (معلق)     │ │  (ملغي)     │                                           ║
 * ║  └──────────────┘ └──────────────┘                                           ║
 * ║                                                                                ║
 * ║  ═══════════════════════════════════════════════════════════════════════════  ║
 * ║                                                                                ║
 * ║  📧 الإشعارات المرسلة:                                                        ║
 * ║  ═════════════════════                                                         ║
 * ║                                                                                ║
 * ║  • قبل 3 أيام من انتهاء التجربة                                              ║
 * ║  • عند انتهاء التجربة                                                         ║
 * ║  • عند نجاح الدفع                                                             ║
 * ║  • عند فشل الدفع                                                              ║
 * ║  • قبل 7 أيام من التجديد                                                      ║
 * ║  • عند تعليق الحساب                                                           ║
 * ║  • عند إلغاء الاشتراك                                                         ║
 * ║                                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
