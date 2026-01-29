/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhook Event Entity                       ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Entity يمثل أحداث الـ Webhooks المستلمة                            ║
 * ║                                                                                ║
 * ║  🎯 الغرض الأساسي: Idempotency (عدم التكرار)                                  ║
 * ║  ═══════════════════════════════════════════════                               ║
 * ║                                                                                ║
 * ║  المشكلة:                                                                      ║
 * ║  - منصة سلة قد ترسل نفس الـ webhook أكثر من مرة                               ║
 * ║  - إذا فشل التوصيل، سلة تعيد المحاولة                                         ║
 * ║  - بدون Idempotency، قد نرسل للعميل نفس الرسالة مرتين!                        ║
 * ║                                                                                ║
 * ║  الحل:                                                                         ║
 * ║  - نخزن كل webhook نستلمه                                                      ║
 * ║  - قبل المعالجة، نتحقق هل سبق معالجته                                          ║
 * ║  - إذا نعم → نتجاهله (نرد 200 OK فقط)                                          ║
 * ║  - إذا لا → نعالجه ونخزنه                                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Store } from './store.entity';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🏷️ TYPES & ENUMS                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/**
 * 📌 WebhookSource - مصدر الـ Webhook
 */
export enum WebhookSource {
  /** من منصة سلة */
  SALLA = 'salla',
  /** من WhatsApp */
  WHATSAPP = 'whatsapp',
  /** من Instagram */
  INSTAGRAM = 'instagram',
  /** من Discord */
  DISCORD = 'discord',
  /** من Stripe */
  STRIPE = 'stripe',
  /** من Moyasar */
  MOYASAR = 'moyasar',
}

/**
 * 📌 WebhookStatus - حالة معالجة الـ Webhook
 */
export enum WebhookStatus {
  /** مستلم - لم يُعالج بعد */
  RECEIVED = 'received',
  /** قيد المعالجة */
  PROCESSING = 'processing',
  /** تمت المعالجة بنجاح */
  PROCESSED = 'processed',
  /** فشلت المعالجة */
  FAILED = 'failed',
  /** تم تخطيه (مكرر أو غير مطلوب) */
  SKIPPED = 'skipped',
  /** تم تأجيله (سيُعالج لاحقاً) */
  DEFERRED = 'deferred',
}

/**
 * 📌 ProcessingResult - نتيجة المعالجة
 */
export interface ProcessingResult {
  /** هل نجحت المعالجة */
  success: boolean;
  /** الإجراءات التي تمت */
  actions?: string[];
  /** رسائل أُرسلت */
  messagesSent?: number;
  /** الأخطاء (إن وجدت) */
  errors?: string[];
  /** وقت المعالجة بالمللي ثانية */
  processingTimeMs?: number;
}

/**
 * 📌 WebhookMetadata - بيانات إضافية
 */
export interface WebhookMetadata {
  /** رقم المحاولة */
  attemptNumber?: number;
  /** IP المرسل */
  sourceIp?: string;
  /** Headers مهمة */
  headers?: Record<string, string>;
  /** توقيع الـ Webhook */
  signature?: string;
  /** هل تم التحقق من التوقيع */
  signatureVerified?: boolean;
  /** ملاحظات */
  notes?: string;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🗃️ WEBHOOK EVENT ENTITY                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 * 
 * 📊 الجدول: webhook_events
 * 
 * 🔑 الفهارس:
 * - event_id (UNIQUE) → للتحقق من التكرار
 * - store_id + event_type → للبحث حسب المتجر والنوع
 * - status → للبحث عن الفاشلة لإعادة المحاولة
 * - created_at → للتنظيف الدوري
 */
@Entity('webhook_events')
@Index(['eventId'], { unique: true })
@Index(['storeId', 'eventType'])
@Index(['source', 'eventType'])
@Index(['status'])
@Index(['createdAt'])
export class WebhookEvent extends BaseEntity {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔑 IDENTIFIERS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🔑 Event ID - المعرف الفريد للحدث
   * 
   * هذا هو المفتاح الأساسي للـ Idempotency
   * يأتي من المصدر (سلة، واتساب، إلخ)
   * 
   * أمثلة:
   * - سلة: "evt_123456789"
   * - واتساب: "wamid.HBg..."
   * 
   * إذا لم يوفر المصدر ID، ننشئ hash من الـ payload
   */
  @Column({
    name: 'event_id',
    type: 'varchar',
    length: 255,
    comment: 'المعرف الفريد للحدث من المصدر',
  })
  eventId: string;

  /**
   * 🏪 Store ID - معرف المتجر
   * 
   * قد يكون null لـ webhooks عامة (مثل Stripe)
   */
  @Column({
    name: 'store_id',
    type: 'uuid',
    nullable: true,
    comment: 'معرف المتجر المرتبط',
  })
  storeId?: string;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📊 EVENT INFO
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🌐 Source - مصدر الـ Webhook
   */
  @Column({
    type: 'enum',
    enum: WebhookSource,
    comment: 'مصدر الـ Webhook',
  })
  source: WebhookSource;

  /**
   * 📌 Event Type - نوع الحدث
   * 
   * أمثلة من سلة:
   * - "order.created"
   * - "order.updated"
   * - "customer.created"
   * - "product.updated"
   * 
   * أمثلة من واتساب:
   * - "message"
   * - "status"
   */
  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 100,
    comment: 'نوع الحدث',
  })
  eventType: string;

  /**
   * 📦 Payload - البيانات الكاملة
   * 
   * نخزن الـ payload كاملاً لـ:
   * - إمكانية إعادة المعالجة
   * - التصحيح والتتبع
   * - الامتثال (Compliance)
   */
  @Column({
    type: 'jsonb',
    comment: 'البيانات الكاملة للحدث',
  })
  payload: Record<string, any>;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🚦 PROCESSING
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🚦 Status - حالة المعالجة
   */
  @Column({
    type: 'enum',
    enum: WebhookStatus,
    default: WebhookStatus.RECEIVED,
    comment: 'حالة المعالجة',
  })
  status: WebhookStatus;

  /**
   * 📊 Processing Result - نتيجة المعالجة
   */
  @Column({
    name: 'processing_result',
    type: 'jsonb',
    nullable: true,
    comment: 'نتيجة المعالجة',
  })
  processingResult?: ProcessingResult;

  /**
   * ❌ Error Message - رسالة الخطأ
   * 
   * في حالة فشل المعالجة
   */
  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
    comment: 'رسالة الخطأ إن وجدت',
  })
  errorMessage?: string;

  /**
   * 🔄 Retry Count - عدد محاولات إعادة المعالجة
   */
  @Column({
    name: 'retry_count',
    type: 'integer',
    default: 0,
    comment: 'عدد محاولات إعادة المعالجة',
  })
  retryCount: number;

  /**
   * ⏰ Next Retry At - موعد المحاولة القادمة
   */
  @Column({
    name: 'next_retry_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'موعد المحاولة القادمة',
  })
  nextRetryAt?: Date;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📅 TIMESTAMPS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📅 Received At - وقت الاستلام
   * 
   * الوقت الذي وصلنا فيه الـ Webhook
   */
  @Column({
    name: 'received_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    comment: 'وقت استلام الـ Webhook',
  })
  receivedAt: Date;

  /**
   * 📅 Processed At - وقت المعالجة
   */
  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'وقت اكتمال المعالجة',
  })
  processedAt?: Date;

  /**
   * 📅 Event Timestamp - وقت الحدث الأصلي
   * 
   * الوقت الذي حدث فيه الحدث في المصدر
   * (قد يختلف عن وقت الاستلام)
   */
  @Column({
    name: 'event_timestamp',
    type: 'timestamptz',
    nullable: true,
    comment: 'وقت الحدث في المصدر',
  })
  eventTimestamp?: Date;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📝 METADATA
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📝 Metadata - بيانات إضافية
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
    comment: 'بيانات إضافية',
  })
  metadata: WebhookMetadata;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔗 RELATIONS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  @ManyToOne(() => Store, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'store_id' })
  store?: Store;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         📚 IDEMPOTENCY EXPLAINED                               ║
 * ╠═══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                                ║
 * ║  🔄 ما هو الـ Idempotency؟                                                    ║
 * ║  ══════════════════════════                                                    ║
 * ║                                                                                ║
 * ║  Idempotency = العملية التي تُنفّذ مرة واحدة فقط                              ║
 * ║  حتى لو طُلبت عدة مرات                                                        ║
 * ║                                                                                ║
 * ║  مثال بسيط:                                                                    ║
 * ║  - العميل طلب منتج                                                            ║
 * ║  - سلة أرسلت webhook "order.created"                                          ║
 * ║  - نحن أرسلنا رسالة "شكراً على طلبك!"                                        ║
 * ║  - الشبكة تقطعت قبل أن نرد 200 OK                                            ║
 * ║  - سلة أعادت إرسال نفس الـ webhook                                            ║
 * ║                                                                                ║
 * ║  بدون Idempotency:                                                            ║
 * ║  ❌ نرسل نفس الرسالة مرتين! (سيء جداً)                                       ║
 * ║                                                                                ║
 * ║  مع Idempotency:                                                              ║
 * ║  ✅ نتحقق أن الحدث سبق معالجته → نتجاهله                                     ║
 * ║                                                                                ║
 * ║  ═══════════════════════════════════════════════════════════════════════════  ║
 * ║                                                                                ║
 * ║  📊 خوارزمية المعالجة:                                                        ║
 * ║  ═════════════════════                                                         ║
 * ║                                                                                ║
 * ║  1. استلام الـ Webhook                                                        ║
 * ║     ↓                                                                          ║
 * ║  2. استخراج الـ event_id                                                      ║
 * ║     ↓                                                                          ║
 * ║  3. البحث في webhook_events:                                                  ║
 * ║     │                                                                          ║
 * ║     ├─ موجود؟ → إرجاع 200 OK (تجاهل)                                         ║
 * ║     │                                                                          ║
 * ║     └─ غير موجود؟ → متابعة...                                                 ║
 * ║        ↓                                                                       ║
 * ║  4. إنشاء سجل جديد (status = RECEIVED)                                       ║
 * ║     ↓                                                                          ║
 * ║  5. معالجة الـ Webhook                                                        ║
 * ║     ↓                                                                          ║
 * ║  6. تحديث السجل (status = PROCESSED/FAILED)                                  ║
 * ║     ↓                                                                          ║
 * ║  7. إرجاع 200 OK                                                              ║
 * ║                                                                                ║
 * ║  ═══════════════════════════════════════════════════════════════════════════  ║
 * ║                                                                                ║
 * ║  🧹 التنظيف الدوري:                                                           ║
 * ║  ═════════════════                                                             ║
 * ║                                                                                ║
 * ║  - نحذف الأحداث القديمة (أكثر من 30 يوم)                                      ║
 * ║  - نحتفظ بالفاشلة للمراجعة                                                    ║
 * ║  - نعيد محاولة الفاشلة (حد أقصى 3 مرات)                                       ║
 * ║                                                                                ║
 * ║  Cron Job مقترح:                                                               ║
 * ║  - كل ساعة: إعادة محاولة الفاشلة                                              ║
 * ║  - كل يوم: حذف الأحداث أقدم من 30 يوم                                        ║
 * ║                                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
