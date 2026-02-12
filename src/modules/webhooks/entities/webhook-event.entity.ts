/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhook Event Entity                       ║
 * ║                    (Webhooks Module Copy — same as @database version)          ║
 * ║                                                                                ║
 * ║  ⚠️ هذا الملف هو نسخة من: src/database/entities/webhook-event.entity.ts       ║
 * ║  الاختلاف الوحيد: مسارات الاستيراد (relative paths)                            ║
 * ║  ✅ v4: إضافة دعم منصة زد (Zid) — ZidEventType + ZID_TO_UNIFIED_EVENT_MAP    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 *
 * 📁 الملف الأصلي: src/database/entities/webhook-event.entity.ts
 * 📁 هذا الملف: src/modules/webhooks/entities/webhook-event.entity.ts
 *
 * ⚠️ أي تعديل يجب أن يُطبّق على كلا الملفين
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
// ✅ تم تصحيح المسار - يشير مباشرة للـ Store entity الجديد
import { Store } from '../../stores/entities/store.entity';

// ✅ Re-export everything from the database version for convenience
// If this module copy exists, it must export the same symbols

export enum WebhookSource {
  SALLA = 'salla',
  ZID = 'zid',             // ✅ v4: منصة زد
  WHATSAPP = 'whatsapp',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
  STRIPE = 'stripe',
  MOYASAR = 'moyasar',
  CUSTOM = 'custom',
}

export enum WebhookStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  RETRY_PENDING = 'retry_pending',
}

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

export enum ZidEventType {
  // Order Events
  ORDER_CREATE = 'order.create',
  ORDER_UPDATE = 'order.update',
  ORDER_STATUS_UPDATE = 'order.status.update',
  ORDER_PAYMENT_STATUS_UPDATE = 'order.payment_status.update',
  ORDER_CANCEL = 'order.cancel',

  // Customer Events
  CUSTOMER_CREATE = 'customer.create',
  CUSTOMER_UPDATE = 'customer.update',
  CUSTOMER_MERCHANT_UPDATE = 'customer.merchant.update',

  // Product Events
  PRODUCT_CREATE = 'product.create',
  PRODUCT_UPDATE = 'product.update',
  PRODUCT_DELETE = 'product.delete',
  PRODUCT_PUBLISH = 'product.publish',

  // Cart Events
  ABANDONED_CART_CREATED = 'abandoned_cart.created',

  // Review Events
  REVIEW_CREATE = 'review.create',
}

export const ZID_TO_UNIFIED_EVENT_MAP: Record<string, string> = {
  [ZidEventType.ORDER_CREATE]: 'order.created',
  [ZidEventType.ORDER_UPDATE]: 'order.updated',
  [ZidEventType.ORDER_STATUS_UPDATE]: 'order.status.updated',
  [ZidEventType.ORDER_PAYMENT_STATUS_UPDATE]: 'order.payment.updated',
  [ZidEventType.ORDER_CANCEL]: 'order.cancelled',
  [ZidEventType.CUSTOMER_CREATE]: 'customer.created',
  [ZidEventType.CUSTOMER_UPDATE]: 'customer.updated',
  [ZidEventType.CUSTOMER_MERCHANT_UPDATE]: 'customer.updated',
  [ZidEventType.PRODUCT_CREATE]: 'product.created',
  [ZidEventType.PRODUCT_UPDATE]: 'product.updated',
  [ZidEventType.PRODUCT_DELETE]: 'product.deleted',
  [ZidEventType.PRODUCT_PUBLISH]: 'product.available',
  [ZidEventType.ABANDONED_CART_CREATED]: 'cart.abandoned',
  [ZidEventType.REVIEW_CREATE]: 'review.added',
};

@Entity('webhook_events')
@Index(['tenantId', 'status', 'createdAt'])
@Index(['source', 'eventType', 'createdAt'])
@Index(['idempotencyKey'], { unique: true, where: '"idempotency_key" IS NOT NULL' })
@Index(['externalId', 'source'])
export class WebhookEvent extends BaseEntity {
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

  @Column({
    name: 'store_id',
    type: 'uuid',
    nullable: true,
    comment: 'معرّف المتجر',
  })
  storeId?: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'مفتاح فريد لمنع التكرار',
  })
  idempotencyKey?: string;

  @Column({
    name: 'external_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'معرّف الحدث من المصدر',
  })
  externalId?: string;

  @Column({
    type: 'varchar',
    length: 50,
    comment: 'مصدر الـ Webhook (salla, zid, whatsapp, ...)',
  })
  source: string;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 100,
    comment: 'نوع الحدث',
  })
  @Index()
  eventType: string;

  @Column({
    type: 'jsonb',
    comment: 'بيانات الـ Webhook كاملة',
  })
  payload: Record<string, unknown>;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'HTTP Headers',
  })
  headers?: Record<string, string>;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'pending',
    comment: 'حالة المعالجة',
  })
  status: string;

  @Column({
    type: 'integer',
    default: 0,
    comment: 'عدد محاولات المعالجة',
  })
  attempts: number;

  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ المعالجة',
  })
  processedAt?: Date;

  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
    comment: 'رسالة الخطأ',
  })
  errorMessage?: string;

  @Column({
    name: 'processing_result',
    type: 'jsonb',
    nullable: true,
    comment: 'نتيجة المعالجة',
  })
  processingResult?: Record<string, unknown>;

  @Column({
    name: 'ip_address',
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: 'عنوان IP',
  })
  ipAddress?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'توقيع التحقق',
  })
  signature?: string;

  @Column({
    name: 'signature_verified',
    type: 'boolean',
    default: false,
    comment: 'هل تم التحقق من التوقيع',
  })
  signatureVerified: boolean;

  @Column({
    name: 'processing_duration_ms',
    type: 'integer',
    nullable: true,
    comment: 'مدة المعالجة بالـ ms',
  })
  processingDurationMs?: number;

  @Column({
    name: 'related_entity_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'معرّف الكيان المرتبط',
  })
  relatedEntityId?: string;

  @Column({
    name: 'related_entity_type',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'نوع الكيان المرتبط',
  })
  relatedEntityType?: string;
}
