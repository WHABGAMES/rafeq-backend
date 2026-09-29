/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Campaign Entity                            ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Entity يمثل الحملات التسويقية                                      ║
 * ║  الحملة = مجموعة رسائل تُرسل لشريحة معينة من العملاء                          ║
 * ║                                                                                ║
 * ║  أنواع الحملات:                                                               ║
 * ║  - فورية (One-time): ترسل مرة واحدة فوراً                                     ║
 * ║  - مجدولة (Scheduled): ترسل في وقت محدد                                       ║
 * ║  - آلية (Automated/Trigger): تُفعّل بحدث معين                                 ║
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
// ✅ تم تصحيح المسار - يشير مباشرة للـ Store entity الجديد
import { Store } from '../../modules/stores/entities/store.entity';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🏷️ TYPES & ENUMS                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/**
 * 📌 CampaignType - نوع الحملة
 */
export enum CampaignType {
  /** حملة فورية - ترسل مباشرة */
  IMMEDIATE = 'immediate',
  /** حملة مجدولة - ترسل في وقت محدد */
  SCHEDULED = 'scheduled',
  /** حملة آلية - تُفعّل بحدث */
  AUTOMATED = 'automated',
  /** حملة متكررة - ترسل بشكل دوري */
  RECURRING = 'recurring',
}

/**
 * 📌 CampaignStatus - حالة الحملة
 */
export enum CampaignStatus {
  /** مسودة - لم تُفعّل بعد */
  DRAFT = 'draft',
  /** مجدولة - تنتظر وقت الإرسال */
  SCHEDULED = 'scheduled',
  /** نشطة - قيد الإرسال */
  ACTIVE = 'active',
  /** متوقفة مؤقتاً */
  PAUSED = 'paused',
  /** مكتملة */
  COMPLETED = 'completed',
  /** ملغاة */
  CANCELLED = 'cancelled',
  /** فشلت */
  FAILED = 'failed',
}

/**
 * 📌 CampaignChannel - قناة الإرسال
 */
export enum CampaignChannel {
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
  EMAIL = 'email',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
}

/**
 * 📌 TriggerType - نوع المُحفّز (للحملات الآلية)
 */
export enum TriggerType {
  /** عند إنشاء طلب */
  ORDER_CREATED = 'order_created',
  /** عند دفع الطلب */
  ORDER_PAID = 'order_paid',
  /** عند شحن الطلب */
  ORDER_SHIPPED = 'order_shipped',
  /** عند توصيل الطلب */
  ORDER_DELIVERED = 'order_delivered',
  /** عند إلغاء الطلب */
  ORDER_CANCELLED = 'order_cancelled',
  /** عند إنشاء عميل جديد */
  CUSTOMER_CREATED = 'customer_created',
  /** عيد ميلاد العميل */
  CUSTOMER_BIRTHDAY = 'customer_birthday',
  /** سلة متروكة */
  ABANDONED_CART = 'abandoned_cart',
  /** عدم نشاط العميل */
  CUSTOMER_INACTIVE = 'customer_inactive',
  /** بعد فترة من آخر طلب */
  DAYS_AFTER_ORDER = 'days_after_order',
  /** وقت محدد يومياً */
  DAILY_TIME = 'daily_time',
}

/**
 * 📌 SegmentRule - قاعدة الشريحة
 */
export interface SegmentRule {
  /** الحقل */
  field: string;
  /** العملية */
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'not_contains' | 'in' | 'not_in';
  /** القيمة */
  value: unknown;
}

/**
 * 📌 AudienceFilter - فلتر الجمهور المستهدف
 */
export interface AudienceFilter {
  /** نوع الفلتر */
  type: 'all' | 'segment' | 'tags' | 'custom';
  /** قواعد التصفية */
  rules?: SegmentRule[];
  /** الوسوم المستهدفة */
  tags?: string[];
  /** الشرائح المستهدفة */
  segments?: string[];
  /** استثناء عملاء معينين */
  excludeCustomerIds?: string[];
  /** شرط AND/OR بين القواعد */
  condition?: 'and' | 'or';
}

/**
 * 📌 MessageTemplate - قالب الرسالة
 */
export interface MessageTemplate {
  /** معرف القالب (إذا كان محفوظ) */
  templateId?: string;
  /** نوع الرسالة */
  type: 'text' | 'image' | 'document' | 'template';
  /** نص الرسالة */
  body: string;
  /** العنوان (للقوالب) */
  header?: {
    type: 'text' | 'image' | 'document' | 'video';
    value: string;
  };
  /** الأزرار */
  buttons?: Array<{
    type: 'quick_reply' | 'url' | 'phone';
    text: string;
    value?: string;
  }>;
  /** رابط الصورة */
  mediaUrl?: string;
  /** اسم الملف */
  filename?: string;
  /** المتغيرات المستخدمة */
  variables?: string[];
}

/**
 * 📌 TriggerConfig - إعدادات المُحفّز
 */
export interface TriggerConfig {
  /** نوع المُحفّز */
  type: TriggerType;
  /** التأخير قبل الإرسال (بالدقائق) */
  delayMinutes?: number;
  /** شروط إضافية */
  conditions?: SegmentRule[];
  /** أوقات الإرسال المسموحة */
  allowedHours?: { start: number; end: number };
  /** أيام الأسبوع المسموحة */
  allowedDays?: number[];
}

/**
 * 📌 ScheduleConfig - إعدادات الجدولة
 */
export interface ScheduleConfig {
  /** تاريخ/وقت الإرسال */
  sendAt?: string;
  /** المنطقة الزمنية */
  timezone?: string;
  /** للحملات المتكررة: نوع التكرار */
  recurrence?: {
    type: 'daily' | 'weekly' | 'monthly';
    interval: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endDate?: string;
  };
}

/**
 * 📌 CampaignStats - إحصائيات الحملة
 */
export interface CampaignStats {
  /** إجمالي المستهدفين */
  totalTargeted: number;
  /** الرسائل المرسلة */
  sent: number;
  /** الرسائل المُوصّلة */
  delivered: number;
  /** الرسائل المقروءة */
  read: number;
  /** الردود */
  replied: number;
  /** الفاشلة */
  failed: number;
  /** الروابط المضغوطة */
  clicked: number;
  /** إلغاء الاشتراك */
  unsubscribed: number;
  /** تكلفة الرسائل */
  cost?: number;
}

/**
 * 📌 CampaignMetadata - بيانات إضافية
 */
export interface CampaignMetadata {
  /** ملاحظات داخلية */
  notes?: string;
  /** آخر خطأ */
  lastError?: string;
  /** سجل التغييرات */
  changelog?: Array<{
    action: string;
    timestamp: string;
    userId?: string;
  }>;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🗃️ CAMPAIGN ENTITY                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
@Entity('campaigns')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'type'])
@Index(['tenantId', 'createdAt'])
@Index(['storeId', 'status'])
export class Campaign extends BaseEntity {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔑 IDENTIFIERS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🏢 Tenant ID - معرف المستأجر
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /**
   * 🏪 Store ID - معرف المتجر (اختياري)
   * 
   * إذا كانت الحملة لمتجر محدد
   * null = تشمل كل متاجر الـ tenant
   */
  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string;

  /**
   * 👤 Created By - منشئ الحملة
   */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📝 BASIC INFO
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📛 Name - اسم الحملة
   */
  @Column({
    type: 'varchar',
    length: 255,
    comment: 'اسم الحملة',
  })
  name: string;

  /**
   * 📝 Description - وصف الحملة
   */
  @Column({
    type: 'text',
    nullable: true,
    comment: 'وصف الحملة',
  })
  description?: string;

  /**
   * 📋 Type - نوع الحملة
   */
  @Column({
    type: 'enum',
    enum: CampaignType,
    comment: 'نوع الحملة',
  })
  type: CampaignType;

  /**
   * 🚦 Status - حالة الحملة
   */
  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.DRAFT,
    comment: 'حالة الحملة',
  })
  status: CampaignStatus;

  /**
   * 📱 Channel - قناة الإرسال
   */
  @Column({
    type: 'enum',
    enum: CampaignChannel,
    comment: 'قناة الإرسال',
  })
  channel: CampaignChannel;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🎯 TARGETING
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🎯 Audience Filter - فلتر الجمهور
   * 
   * يحدد من سيستلم الحملة
   */
  @Column({
    name: 'audience_filter',
    type: 'jsonb',
    nullable: true,
    comment: 'فلتر الجمهور المستهدف',
  })
  audienceFilter?: AudienceFilter;

  /**
   * 👥 Estimated Audience - العدد التقديري
   * 
   * يُحسب عند حفظ الحملة
   */
  @Column({
    name: 'estimated_audience',
    type: 'integer',
    default: 0,
    comment: 'العدد التقديري للجمهور',
  })
  estimatedAudience: number;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              💬 MESSAGE
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 💬 Message Template - قالب الرسالة
   */
  @Column({
    name: 'message_template',
    type: 'jsonb',
    comment: 'قالب الرسالة',
  })
  messageTemplate: MessageTemplate;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              ⏰ SCHEDULING
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * ⏰ Schedule Config - إعدادات الجدولة
   * 
   * للحملات المجدولة والمتكررة
   */
  @Column({
    name: 'schedule_config',
    type: 'jsonb',
    nullable: true,
    comment: 'إعدادات الجدولة',
  })
  scheduleConfig?: ScheduleConfig;

  /**
   * 📅 Scheduled At - موعد الإرسال المجدول
   */
  @Column({
    name: 'scheduled_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'موعد الإرسال المجدول',
  })
  scheduledAt?: Date;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔔 TRIGGERS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🔔 Trigger Config - إعدادات المُحفّز
   * 
   * للحملات الآلية
   */
  @Column({
    name: 'trigger_config',
    type: 'jsonb',
    nullable: true,
    comment: 'إعدادات المُحفّز للحملات الآلية',
  })
  triggerConfig?: TriggerConfig;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📊 STATS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📊 Stats - إحصائيات الحملة
   */
  @Column({
    type: 'jsonb',
    default: {
      totalTargeted: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      clicked: 0,
      unsubscribed: 0,
    },
    comment: 'إحصائيات الحملة',
  })
  stats: CampaignStats;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📅 DATES
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📅 Started At - تاريخ البدء
   */
  @Column({
    name: 'started_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ بدء الإرسال',
  })
  startedAt?: Date;

  /**
   * 📅 Completed At - تاريخ الاكتمال
   */
  @Column({
    name: 'completed_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ اكتمال الحملة',
  })
  completedAt?: Date;

  /**
   * 📅 Last Run At - آخر تشغيل (للحملات المتكررة)
   */
  @Column({
    name: 'last_run_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ آخر تشغيل',
  })
  lastRunAt?: Date;

  /**
   * 📅 Next Run At - التشغيل القادم (للحملات المتكررة)
   */
  @Column({
    name: 'next_run_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ التشغيل القادم',
  })
  nextRunAt?: Date;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              ⚙️ SETTINGS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🔢 Rate Limit - حد الإرسال
   * 
   * عدد الرسائل في الدقيقة (لتجنب الحظر)
   */
  @Column({
    name: 'rate_limit',
    type: 'integer',
    default: 30,
    comment: 'حد الإرسال في الدقيقة',
  })
  rateLimit: number;

  /**
   * ⏹️ Stop On Error - التوقف عند الخطأ
   */
  @Column({
    name: 'stop_on_error_threshold',
    type: 'integer',
    nullable: true,
    comment: 'التوقف عند وصول الأخطاء لهذا العدد',
  })
  stopOnErrorThreshold?: number;

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
  metadata: CampaignMetadata;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔗 RELATIONS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Store, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'store_id' })
  store?: Store;
}
