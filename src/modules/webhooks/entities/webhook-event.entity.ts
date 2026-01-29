/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhook Event Entity                       ║
 * ║                                                                                ║
 * ║  جدول لحفظ جميع الـ Webhook Events الواردة                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { Tenant } from '../../../database/entities/tenant.entity';
import { Store } from '../../../database/entities/store.entity';

/**
 * 📌 لماذا نحفظ الـ Webhook Events؟
 * 
 * 1. Debugging: لمعرفة ما حدث إذا في مشكلة
 * 2. Audit Trail: سجل كامل لكل الأحداث
 * 3. Replay: إعادة معالجة event إذا فشل
 * 4. Analytics: تحليل أنماط الأحداث
 * 5. Idempotency: منع معالجة نفس الحدث مرتين
 */

/**
 * مصدر الـ Webhook
 */
export enum WebhookSource {
  SALLA = 'salla',
  WHATSAPP = 'whatsapp',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
  STRIPE = 'stripe',
  MOYASAR = 'moyasar',
  CUSTOM = 'custom',
}

/**
 * حالة معالجة الـ Webhook
 */
export enum WebhookStatus {
  /** استُقبل وينتظر المعالجة */
  PENDING = 'pending',
  /** قيد المعالجة */
  PROCESSING = 'processing',
  /** تمت المعالجة بنجاح */
  PROCESSED = 'processed',
  /** فشلت المعالجة */
  FAILED = 'failed',
  /** تم تخطيه (مكرر أو غير مهم) */
  SKIPPED = 'skipped',
  /** في انتظار إعادة المحاولة */
  RETRY_PENDING = 'retry_pending',
}

/**
 * أنواع أحداث سلة الرئيسية
 */
export enum SallaEventType {
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Order Events - أحداث الطلبات
  // ═══════════════════════════════════════════════════════════════════════════════
  ORDER_CREATED = 'order.created',
  ORDER_UPDATED = 'order.updated',
  ORDER_STATUS_UPDATED = 'order.status.updated',
  ORDER_PAYMENT_UPDATED = 'order.payment.updated',
  ORDER_CANCELLED = 'order.cancelled',
  ORDER_REFUNDED = 'order.refunded',
  ORDER_SHIPPED = 'order.shipped',
  ORDER_DELIVERED = 'order.delivered',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customer Events - أحداث العملاء
  // ═══════════════════════════════════════════════════════════════════════════════
  CUSTOMER_CREATED = 'customer.created',
  CUSTOMER_UPDATED = 'customer.updated',
  CUSTOMER_LOGIN = 'customer.login',
  CUSTOMER_OTP_REQUEST = 'customer.otp.request',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Product Events - أحداث المنتجات
  // ═══════════════════════════════════════════════════════════════════════════════
  PRODUCT_CREATED = 'product.created',
  PRODUCT_UPDATED = 'product.updated',
  PRODUCT_DELETED = 'product.deleted',
  PRODUCT_AVAILABLE = 'product.available',
  PRODUCT_QUANTITY_LOW = 'product.quantity.low',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Cart Events - أحداث السلة
  // ═══════════════════════════════════════════════════════════════════════════════
  ABANDONED_CART = 'abandoned.cart',
  CART_UPDATED = 'cart.updated',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚚 Shipment Events - أحداث الشحن
  // ═══════════════════════════════════════════════════════════════════════════════
  SHIPMENT_CREATED = 'shipment.created',
  SHIPMENT_CREATING = 'shipment.creating',
  SHIPMENT_CANCELLED = 'shipment.cancelled',
  SHIPMENT_RETURN_CREATING = 'shipment.return.creating',
  SHIPMENT_RETURN_CREATED = 'shipment.return.created',
  SHIPMENT_RETURN_CANCELLED = 'shipment.return.cancelled',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📍 Tracking Events - أحداث التتبع
  // ═══════════════════════════════════════════════════════════════════════════════
  TRACKING_REFRESHED = 'tracking.refreshed',

  // ═══════════════════════════════════════════════════════════════════════════════
  // ⭐ Review Events - أحداث التقييمات
  // ═══════════════════════════════════════════════════════════════════════════════
  REVIEW_ADDED = 'review.added',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎁 Coupon Events - أحداث الكوبونات
  // ═══════════════════════════════════════════════════════════════════════════════
  COUPON_APPLIED = 'coupon.applied',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Store Events - أحداث المتجر
  // ═══════════════════════════════════════════════════════════════════════════════
  STORE_BRANCH_SETDEFAULT = 'store.branch.setDefault',
  STOREBRANCH_CREATED = 'storebranch.created',
  STOREBRANCH_UPDATED = 'storebranch.updated',
  STOREBRANCH_DELETED = 'storebranch.deleted',
  STOREBRANCH_ACTIVATED = 'storebranch.activated',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 App Events - أحداث التطبيق
  // ═══════════════════════════════════════════════════════════════════════════════
  APP_INSTALLED = 'app.installed',
  APP_UNINSTALLED = 'app.uninstalled',
  APP_TOKEN_CREATED = 'app.token.created',
  APP_STORE_AUTHORIZE = 'app.store.authorize',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💰 Invoice Events - أحداث الفواتير
  // ═══════════════════════════════════════════════════════════════════════════════
  INVOICE_CREATED = 'invoice.created',

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 Specialoffer Events - العروض الخاصة
  // ═══════════════════════════════════════════════════════════════════════════════
  SPECIALOFFER_CREATED = 'specialoffer.created',
  SPECIALOFFER_UPDATED = 'specialoffer.updated',
}

@Entity('webhook_events')
@Index(['tenantId', 'status', 'createdAt'])
@Index(['source', 'eventType', 'createdAt'])
@Index(['idempotencyKey'], { unique: true, where: '"idempotency_key" IS NOT NULL' })
@Index(['externalId', 'source'])
export class WebhookEvent extends BaseEntity {
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 Relations - العلاقات
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * الـ Tenant (المتجر) المالك للحدث
   */
  @Column({
    name: 'tenant_id',
    type: 'uuid',
    comment: 'معرّف الـ Tenant',
  })
  @Index()
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * المتجر المرتبط (إذا كان الـ webhook من سلة)
   */
  @Column({
    name: 'store_id',
    type: 'uuid',
    nullable: true,
    comment: 'معرّف المتجر في سلة',
  })
  storeId?: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 Event Identification - تحديد الحدث
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔑 Idempotency Key
   * 
   * مفتاح فريد لمنع معالجة نفس الحدث مرتين
   * 
   * كيف يعمل:
   * 1. سلة ترسل webhook مع event ID
   * 2. نحسب hash من (source + event_type + external_id)
   * 3. إذا كان الـ hash موجود = الحدث مكرر → نتجاهله
   * 
   * لماذا مهم؟
   * - سلة قد ترسل نفس الـ webhook أكثر من مرة (retry)
   * - نريد معالجة كل حدث مرة واحدة فقط
   */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'مفتاح فريد لمنع التكرار',
  })
  idempotencyKey?: string;

  /**
   * 🆔 External ID
   * 
   * معرّف الحدث من المصدر الخارجي
   * مثال: event_id من سلة
   */
  @Column({
    name: 'external_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'معرّف الحدث من المصدر',
  })
  externalId?: string;

  /**
   * 📡 Source
   * 
   * مصدر الـ webhook
   */
  @Column({
    type: 'enum',
    enum: WebhookSource,
    comment: 'مصدر الـ Webhook',
  })
  source: WebhookSource;

  /**
   * 📌 Event Type
   * 
   * نوع الحدث (مثل: order.created, customer.updated)
   */
  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 100,
    comment: 'نوع الحدث',
  })
  @Index()
  eventType: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Payload - البيانات
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📦 Payload
   * 
   * البيانات الكاملة للـ webhook
   * نحفظها كـ JSONB للمرونة
   */
  @Column({
    type: 'jsonb',
    comment: 'بيانات الـ Webhook كاملة',
  })
  payload: Record<string, unknown>;

  /**
   * 📋 Headers
   * 
   * الـ HTTP headers الواردة مع الـ webhook
   * مفيدة للـ debugging
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'HTTP Headers',
  })
  headers?: Record<string, string>;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Processing Status - حالة المعالجة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📊 Status
   * 
   * حالة معالجة الـ webhook
   */
  @Column({
    type: 'enum',
    enum: WebhookStatus,
    default: WebhookStatus.PENDING,
    comment: 'حالة المعالجة',
  })
  status: WebhookStatus;

  /**
   * 🔄 Attempts
   * 
   * عدد محاولات المعالجة
   */
  @Column({
    type: 'integer',
    default: 0,
    comment: 'عدد محاولات المعالجة',
  })
  attempts: number;

  /**
   * ⏰ Processed At
   * 
   * تاريخ اكتمال المعالجة
   */
  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ المعالجة',
  })
  processedAt?: Date;

  /**
   * ❌ Error Message
   * 
   * رسالة الخطأ إذا فشلت المعالجة
   */
  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
    comment: 'رسالة الخطأ',
  })
  errorMessage?: string;

  /**
   * 📝 Processing Result
   * 
   * نتيجة المعالجة (للـ debugging)
   */
  @Column({
    name: 'processing_result',
    type: 'jsonb',
    nullable: true,
    comment: 'نتيجة المعالجة',
  })
  processingResult?: Record<string, unknown>;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Metadata - بيانات إضافية
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🌐 IP Address
   * 
   * عنوان IP المُرسل
   */
  @Column({
    name: 'ip_address',
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: 'عنوان IP',
  })
  ipAddress?: string;

  /**
   * 🔐 Signature
   * 
   * التوقيع المُستخدم للتحقق
   */
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'توقيع التحقق',
  })
  signature?: string;

  /**
   * ✅ Signature Verified
   * 
   * هل تم التحقق من التوقيع؟
   */
  @Column({
    name: 'signature_verified',
    type: 'boolean',
    default: false,
    comment: 'هل تم التحقق من التوقيع',
  })
  signatureVerified: boolean;

  /**
   * ⏱️ Processing Duration (ms)
   * 
   * مدة المعالجة بالـ milliseconds
   */
  @Column({
    name: 'processing_duration_ms',
    type: 'integer',
    nullable: true,
    comment: 'مدة المعالجة بالـ ms',
  })
  processingDurationMs?: number;

  /**
   * 🔗 Related Entity ID
   * 
   * معرّف الكيان المرتبط (مثل: order_id, customer_id)
   */
  @Column({
    name: 'related_entity_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'معرّف الكيان المرتبط',
  })
  relatedEntityId?: string;

  /**
   * 📋 Related Entity Type
   * 
   * نوع الكيان المرتبط
   */
  @Column({
    name: 'related_entity_type',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'نوع الكيان المرتبط',
  })
  relatedEntityType?: string;
}

/**
 * 📌 الجدول الناتج:
 * 
 * CREATE TABLE webhook_events (
 *   id UUID PRIMARY KEY,
 *   tenant_id UUID NOT NULL REFERENCES tenants(id),
 *   store_id UUID REFERENCES stores(id),
 *   idempotency_key VARCHAR(255) UNIQUE,
 *   external_id VARCHAR(255),
 *   source webhook_source NOT NULL,
 *   event_type VARCHAR(100) NOT NULL,
 *   payload JSONB NOT NULL,
 *   headers JSONB,
 *   status webhook_status DEFAULT 'pending',
 *   attempts INTEGER DEFAULT 0,
 *   processed_at TIMESTAMPTZ,
 *   error_message TEXT,
 *   processing_result JSONB,
 *   ip_address VARCHAR(45),
 *   signature VARCHAR(255),
 *   signature_verified BOOLEAN DEFAULT FALSE,
 *   processing_duration_ms INTEGER,
 *   related_entity_id VARCHAR(255),
 *   related_entity_type VARCHAR(50),
 *   created_at TIMESTAMPTZ NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL,
 *   deleted_at TIMESTAMPTZ
 * );
 */
