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
// ✅ تم تصحيح المسار - يشير مباشرة للـ Store entity الجديد
import { Store } from '../../stores/entities/store.entity';

export enum WebhookSource {
  SALLA = 'salla',
  ZID = 'zid',
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

  // ═══════════════════════════════════════════════════════════════
  // 📡 Communication Webhooks (النمط السهل - Communication App)
  // ═══════════════════════════════════════════════════════════════
  COMMUNICATION_SMS_SEND = 'communication.sms.send',
  COMMUNICATION_EMAIL_SEND = 'communication.email.send',
  COMMUNICATION_WHATSAPP_SEND = 'communication.whatsapp.send',
}

/**
 * ✅ v2: محدّث بالكامل ليطابق وثائق Zid الرسمية (dot-notation)
 * المصدر: https://docs.zid.sa/docs/webhook-events
 *
 * ⚠️ القيم القديمة بـ hyphen (new-order, order-update...) تم حذفها —
 *    استخدم القيم الجديدة بـ dot-notation في كل الكود الجديد.
 */
export enum ZidEventType {
  // ─── Order Events ─────────────────────────────────────────────────────────
  /** طلب جديد */
  ORDER_CREATE             = 'order.create',
  /** تحديث حالة الطلب */
  ORDER_STATUS_UPDATE      = 'order.status.update',
  /** تحديث حالة الدفع (paid / unpaid) */
  ORDER_PAYMENT_STATUS_UPDATE = 'order.payment_status.update',

  // ─── Product Events ────────────────────────────────────────────────────────
  /** إنشاء منتج */
  PRODUCT_CREATE           = 'product.create',
  /** تعديل منتج */
  PRODUCT_UPDATE           = 'product.update',
  /** نشر منتج */
  PRODUCT_PUBLISH          = 'product.publish',
  /** حذف منتج */
  PRODUCT_DELETE           = 'product.delete',

  // ─── Abandoned Cart Events ─────────────────────────────────────────────────
  /** سلة متروكة */
  ABANDONED_CART_CREATED   = 'abandoned_cart.created',
  /** سلة مكتملة (عميل عاد وأتمّ الشراء) */
  ABANDONED_CART_COMPLETED = 'abandoned_cart.completed',

  // ─── Customer Events ───────────────────────────────────────────────────────
  /** عميل جديد */
  CUSTOMER_CREATE          = 'customer.create',
  /** تحديث بيانات العميل */
  CUSTOMER_UPDATE          = 'customer.update',
  /** تحديث بيانات التاجر المرتبطة بعميل */
  CUSTOMER_MERCHANT_UPDATE = 'customer.merchant.update',
  /** تسجيل دخول العميل */
  CUSTOMER_LOGIN           = 'customer.login',

  // ─── Product Category Events ───────────────────────────────────────────────
  /** إنشاء قسم */
  CATEGORY_CREATE          = 'category.create',
  /** تعديل قسم */
  CATEGORY_UPDATE          = 'category.update',
  /** حذف قسم */
  CATEGORY_DELETE          = 'category.delete',

  // ─── App Market Lifecycle Events ───────────────────────────────────────────
  APP_AUTHORIZED           = 'app.market.application.authorized',
  APP_INSTALL              = 'app.market.application.install',
  APP_UNINSTALL            = 'app.market.application.uninstall',
  APP_RATED                = 'app.market.application.rated',
  SUBSCRIPTION_ACTIVE      = 'app.market.subscription.active',
  SUBSCRIPTION_WARNING     = 'app.market.subscription.warning',
  SUBSCRIPTION_SUSPENDED   = 'app.market.subscription.suspended',
  SUBSCRIPTION_EXPIRED     = 'app.market.subscription.expired',
  SUBSCRIPTION_RENEW       = 'app.market.subscription.renew',
  SUBSCRIPTION_UPGRADE     = 'app.market.subscription.upgrade',
  SUBSCRIPTION_REFUNDED    = 'app.market.subscription.refunded',
  PRIVATE_PLAN_REQUEST     = 'app.market.private.plan.request',
}

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
    comment: 'معرّف المتجر في سلة',
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
    type: 'enum',
    enum: WebhookSource,
    comment: 'مصدر الـ Webhook',
  })
  source: WebhookSource;

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
    type: 'enum',
    enum: WebhookStatus,
    default: WebhookStatus.PENDING,
    comment: 'حالة المعالجة',
  })
  status: WebhookStatus;

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
