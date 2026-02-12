/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Order Entity                               ║
 * ║  ✅ v4: إضافة zidOrderId + جعل sallaOrderId nullable                         ║
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
// ✅ تم تصحيح المسار - يشير مباشرة للـ Store entity الجديد
import { Store } from '../../modules/stores/entities/store.entity';
import { Customer } from './customer.entity';

export enum OrderStatus {
  CREATED = 'created',
  PROCESSING = 'processing',
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  READY_TO_SHIP = 'ready_to_ship',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  FAILED = 'failed',
  ON_HOLD = 'on_hold',
}

export enum PaymentMethod {
  CASH_ON_DELIVERY = 'cash_on_delivery',
  CREDIT_CARD = 'credit_card',
  MADA = 'mada',
  APPLE_PAY = 'apple_pay',
  STC_PAY = 'stc_pay',
  BANK_TRANSFER = 'bank_transfer',
  TABBY = 'tabby',
  TAMARA = 'tamara',
  OTHER = 'other',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export enum ShippingMethod {
  STANDARD = 'standard',
  EXPRESS = 'express',
  PICKUP = 'pickup',
  LOCAL_DELIVERY = 'local_delivery',
  INTERNATIONAL = 'international',
}

export interface OrderItem {
  productId: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  imageUrl?: string;
  options?: Array<{ name: string; value: string }>;
  metadata?: Record<string, any>;
}

export interface ShippingAddress {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
  countryCode: string;
  coordinates?: { latitude: number; longitude: number };
  notes?: string;
}

export interface ShippingInfo {
  method: ShippingMethod;
  carrierName?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  cost: number;
  estimatedDelivery?: string;
  shippedAt?: string;
  deliveredAt?: string;
}

export interface OrderMetadata {
  source?: string;
  couponCode?: string;
  couponValue?: number;
  customerNotes?: string;
  internalNotes?: string;
  ipAddress?: string;
  userAgent?: string;
  sallaData?: Record<string, any>;
  zidData?: Record<string, any>;     // ✅ v4: بيانات زد الخام
}

/**
 * ✅ v4: الفهارس الفريدة أصبحت مشروطة (conditional)
 * لأن كل طلب قد يكون من سلة أو من زد — لكن ليس من كليهما
 *
 * ⚠️ ملاحظة: الفهارس المشروطة تُنشأ عبر الـ Migration ولا تُدار بواسطة TypeORM sync.
 * migrations/AddZidPlatformSupport1707753600000.ts
 */
@Entity('orders')
@Index(['storeId', 'status'])
@Index(['storeId', 'customerId'])
@Index(['storeId', 'createdAt'])
@Index(['storeId', 'paymentStatus'])
@Index(['tenantId'])
export class Order extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string;

  /**
   * ✅ v4: أصبح nullable — الطلب قد يكون من زد وليس من سلة
   * الفهرس الفريد المشروط: IDX_orders_store_salla_order
   */
  @Column({
    name: 'salla_order_id',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'رقم الطلب في سلة (nullable — قد يكون طلب زد)',
  })
  sallaOrderId?: string;

  /**
   * ✅ v4: معرف الطلب في منصة زد
   * الفهرس الفريد المشروط: IDX_orders_store_zid_order
   */
  @Column({
    name: 'zid_order_id',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'رقم الطلب في زد',
  })
  zidOrderId?: string;

  @Column({
    name: 'reference_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'رقم مرجعي إضافي',
  })
  referenceId?: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.CREATED,
    comment: 'حالة الطلب',
  })
  status: OrderStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
    comment: 'حالة الدفع',
  })
  paymentStatus: PaymentStatus;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
    nullable: true,
    comment: 'طريقة الدفع',
  })
  paymentMethod?: PaymentMethod;

  @Column({
    type: 'jsonb',
    default: [],
    comment: 'منتجات الطلب',
  })
  items: OrderItem[];

  @Column({
    type: 'varchar',
    length: 5,
    default: 'SAR',
    comment: 'العملة',
  })
  currency: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'المجموع الفرعي',
  })
  subtotal: number;

  @Column({
    name: 'discount_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'قيمة الخصم',
  })
  discountAmount: number;

  @Column({
    name: 'shipping_cost',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'تكلفة الشحن',
  })
  shippingCost: number;

  @Column({
    name: 'tax_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'قيمة الضريبة',
  })
  taxAmount: number;

  @Column({
    name: 'total_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'المجموع النهائي',
  })
  totalAmount: number;

  @Column({
    name: 'shipping_address',
    type: 'jsonb',
    nullable: true,
    comment: 'عنوان الشحن',
  })
  shippingAddress?: ShippingAddress;

  @Column({
    name: 'shipping_info',
    type: 'jsonb',
    nullable: true,
    comment: 'معلومات الشحن والتتبع',
  })
  shippingInfo?: ShippingInfo;

  @Column({
    name: 'ordered_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ إنشاء الطلب في المنصة',
  })
  orderedAt?: Date;

  @Column({
    name: 'paid_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ الدفع',
  })
  paidAt?: Date;

  @Column({
    name: 'shipped_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ الشحن',
  })
  shippedAt?: Date;

  @Column({
    name: 'delivered_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ التوصيل',
  })
  deliveredAt?: Date;

  @Column({
    name: 'completed_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ اكتمال الطلب',
  })
  completedAt?: Date;

  @Column({
    name: 'cancelled_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ الإلغاء',
  })
  cancelledAt?: Date;

  @Column({
    name: 'customer_notes',
    type: 'text',
    nullable: true,
    comment: 'ملاحظات العميل',
  })
  customerNotes?: string;

  @Column({
    name: 'internal_notes',
    type: 'text',
    nullable: true,
    comment: 'ملاحظات داخلية للفريق',
  })
  internalNotes?: string;

  @Column({
    name: 'coupon_code',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'كود الخصم المستخدم',
  })
  couponCode?: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
    comment: 'بيانات إضافية',
  })
  metadata: OrderMetadata;

  @Column({
    name: 'notifications_sent',
    type: 'jsonb',
    default: [],
    comment: 'قائمة الإشعارات المرسلة',
  })
  notificationsSent: Array<{
    type: string;
    channel: string;
    sentAt: string;
    messageId?: string;
  }>;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @ManyToOne(() => Customer, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer;
}
