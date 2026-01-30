/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhook Event Entity                       ║
 * ║                                                                                ║
 * ║  جدول لحفظ جميع الـ Webhook Events الواردة                                      ║
 * ║                                                                                ║
 * ║  ⚠️ مهم: هذا الملف يجب أن يطابق:                                              ║
 * ║     /src/modules/webhooks/entities/webhook-event.entity.ts                    ║
 * ║                                                                                ║
 * ║  📌 ملاحظة: لا نستخدم event_id كعمود مطلوب لأن:                               ║
 * ║     - بعض الـ webhooks (مثل test webhooks) لا ترسل event_id                   ║
 * ║     - نستخدم idempotency_key بدلاً منه للتحقق من التكرار                       ║
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
import { Tenant } from './tenant.entity';
import { Store } from './store.entity';

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
  // Order Events
  ORDER_CREATED = 'order.created',
  ORDER_UPDATED = 'order.updated',
  ORDER_STATUS_UPDATED = 'order.status.updated',
  ORDER_PAYMENT_UPDATED = 'order.payment.updated',
  ORDER_CANCELLED = 'order.cancelled',
  ORDER_REFUNDED = 'order.refunded',
  ORDER_SHIPPED = 'order.shipped',
  ORDER_DELIVERED = 'order.delivered',

  // Customer Events
  CUSTOMER_CREATED = 'customer.created',
  CUSTOMER_UPDATED = 'customer.updated',
  CUSTOMER_LOGIN = 'customer.login',
  CUSTOMER_OTP_REQUEST = 'customer.otp.request',

  // Product Events
  PRODUCT_CREATED = 'product.created',
  PRODUCT_UPDATED = 'product.updated',
  PRODUCT_DELETED = 'product.deleted',
  PRODUCT_AVAILABLE = 'product.available',
  PRODUCT_QUANTITY_LOW = 'product.quantity.low',

  // Cart Events
  ABANDONED_CART = 'abandoned.cart',
  CART_UPDATED = 'cart.updated',

  // Shipment Events
  SHIPMENT_CREATED = 'shipment.created',
  SHIPMENT_CREATING = 'shipment.creating',
  SHIPMENT_CANCELLED = 'shipment.cancelled',
  SHIPMENT_RETURN_CREATING = 'shipment.return.creating',
  SHIPMENT_RETURN_CREATED = 'shipment.return.created',
  SHIPMENT_RETURN_CANCELLED = 'shipment.return.cancelled',

  // Tracking Events
  TRACKING_REFRESHED = 'tracking.refreshed',

  // Review Events
  REVIEW_ADDED = 'review.added',

  // Coupon Events
  COUPON_APPLIED = 'coupon.applied',

  // Store Events
  STORE_BRANCH_SETDEFAULT = 'store.branch.setDefault',
  STOREBRANCH_CREATED = 'storebranch.created',
  STOREBRANCH_UPDATED = 'storebranch.updated',
  STOREBRANCH_DELETED = 'storebranch.deleted',
  STOREBRANCH_ACTIVATED = 'storebranch.activated',

  // App Events
  APP_INSTALLED = 'app.installed',
  APP_UNINSTALLED = 'app.uninstalled',
  APP_TOKEN_CREATED = 'app.token.created',
  APP_STORE_AUTHORIZE = 'app.store.authorize',

  // Invoice Events
  INVOICE_CREATED = 'invoice.created',

  // Specialoffer Events
  SPECIALOFFER_CREATED = 'specialoffer.created',
  SPECIALOFFER_UPDATED = 'specialoffer.updated',
}

@Entity('webhook_events')
@Index(['tenantId', 'status', 'createdAt'])
@Index(['source', 'eventType', 'createdAt'])
@Index(['idempotencyKey'], { unique: true, where: '"idempotency_key" IS NOT NULL' })
@Index(['externalId', 'source'])
export class WebhookEvent extends BaseEntity {
  /**
   * الـ Tenant (المتجر) المالك للحدث
   * nullable: true - لأن بعض الـ webhooks تصل قبل ربط المتجر
   */
  @Column({
    name: 'tenant_id',
    type: 'uuid',
    nullable: true,
    comment: 'معرّف الـ Tenant',
  })
  @Index()
  tenantId?: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

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

  /**
   * Idempotency Key - مفتاح فريد لمنع معالجة نفس الحدث مرتين
   * هذا هو البديل عن event_id - نولّده داخلياً
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
   * External ID - معرّف الحدث من المصدر الخارجي (اختياري)
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
   * Source - مصدر الـ webhook
   * نستخدم varchar بدلاً من enum للمرونة
   */
  @Column({
    type: 'varchar',
    length: 50,
    comment: 'مصدر الـ Webhook',
  })
  source: string;

  /**
   * Event Type - نوع الحدث
   */
  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 100,
    comment: 'نوع الحدث',
  })
  @Index()
  eventType: string;

  /**
   * Payload - البيانات الكاملة للـ webhook
   */
  @Column({
    type: 'jsonb',
    comment: 'بيانات الـ Webhook كاملة',
  })
  payload: Record<string, unknown>;

  /**
   * Headers - الـ HTTP headers الواردة
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'HTTP Headers',
  })
  headers?: Record<string, string>;

  /**
   * Status - حالة معالجة الـ webhook
   * نستخدم varchar بدلاً من enum للمرونة
   */
  @Column({
    type: 'varchar',
    length: 50,
    default: 'pending',
    comment: 'حالة المعالجة',
  })
  status: string;

  /**
   * Attempts - عدد محاولات المعالجة
   */
  @Column({
    type: 'integer',
    default: 0,
    comment: 'عدد محاولات المعالجة',
  })
  attempts: number;

  /**
   * Processed At - تاريخ اكتمال المعالجة
   */
  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ المعالجة',
  })
  processedAt?: Date;

  /**
   * Error Message - رسالة الخطأ إذا فشلت المعالجة
   */
  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
    comment: 'رسالة الخطأ',
  })
  errorMessage?: string;

  /**
   * Processing Result - نتيجة المعالجة
   */
  @Column({
    name: 'processing_result',
    type: 'jsonb',
    nullable: true,
    comment: 'نتيجة المعالجة',
  })
  processingResult?: Record<string, unknown>;

  /**
   * IP Address - عنوان IP المُرسل
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
   * Signature - التوقيع المُستخدم للتحقق
   */
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'توقيع التحقق',
  })
  signature?: string;

  /**
   * Signature Verified - هل تم التحقق من التوقيع
   */
  @Column({
    name: 'signature_verified',
    type: 'boolean',
    default: false,
    comment: 'هل تم التحقق من التوقيع',
  })
  signatureVerified: boolean;

  /**
   * Processing Duration (ms)
   */
  @Column({
    name: 'processing_duration_ms',
    type: 'integer',
    nullable: true,
    comment: 'مدة المعالجة بالـ ms',
  })
  processingDurationMs?: number;

  /**
   * Related Entity ID - معرّف الكيان المرتبط
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
   * Related Entity Type - نوع الكيان المرتبط
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
