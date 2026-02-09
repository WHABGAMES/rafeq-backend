/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Employee Notification Rule Entity                    ║
 * ║                                                                                ║
 * ║  قاعدة التنبيه: تربط حدث المتجر → المستلمين → قنوات الإرسال → القالب         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// ═══════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════

/**
 * أنواع الأحداث التي يمكن التنبيه عليها
 */
export enum NotificationTriggerEvent {
  // أحداث الطلبات
  ORDER_CREATED = 'order.created',
  ORDER_UPDATED = 'order.updated',
  ORDER_STATUS_UPDATED = 'order.status.updated',
  ORDER_CANCELLED = 'order.cancelled',
  ORDER_REFUNDED = 'order.refunded',
  ORDER_PAYMENT_UPDATED = 'order.payment.updated',
  ORDER_ASSIGNED = 'order.assigned',

  // أحداث العملاء
  CUSTOMER_CREATED = 'customer.created',
  CUSTOMER_UPDATED = 'customer.updated',
  CUSTOMER_MESSAGE_RECEIVED = 'customer.message.received',

  // أحداث الشحن
  SHIPMENT_CREATED = 'shipment.creating',
  SHIPMENT_UPDATED = 'shipment.updated',
  TRACKING_REFRESHED = 'tracking.refreshed',

  // أحداث المنتجات
  PRODUCT_UPDATED = 'product.updated',
  PRODUCT_LOW_STOCK = 'product.low_stock',

  // أحداث التقييمات
  REVIEW_ADDED = 'review.added',
  REVIEW_NEGATIVE = 'review.negative',

  // أحداث السلة المتروكة
  ABANDONED_CART = 'abandoned.cart',
}

/**
 * قنوات التنبيه المتاحة
 */
export enum NotificationChannel {
  DASHBOARD = 'dashboard',
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

/**
 * نوع المستلمين
 */
export enum RecipientType {
  ALL_EMPLOYEES = 'all_employees',
  SPECIFIC_EMPLOYEES = 'specific_employees',
  BY_ROLE = 'by_role',
  ASSIGNED_EMPLOYEE = 'assigned_employee',
  CUSTOM_PHONES = 'custom_phones',
  CUSTOM_EMAILS = 'custom_emails',
}

// ═══════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════

@Entity('notification_rules')
@Index(['tenantId', 'isActive'])
@Index(['tenantId', 'triggerEvent'])
export class NotificationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /**
   * اسم القاعدة (للعرض في الواجهة)
   * مثال: "تنبيه طلب جديد" أو "إشعار تقييم سلبي"
   */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /**
   * وصف اختياري للقاعدة
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * الحدث الذي يُفعّل التنبيه
   */
  @Column({
    type: 'enum',
    enum: NotificationTriggerEvent,
  })
  triggerEvent: NotificationTriggerEvent;

  /**
   * قنوات الإرسال (يمكن تحديد أكثر من قناة)
   */
  @Column({
    type: 'simple-array',
  })
  channels: NotificationChannel[];

  /**
   * نوع المستلمين
   */
  @Column({
    type: 'enum',
    enum: RecipientType,
    default: RecipientType.ALL_EMPLOYEES,
  })
  recipientType: RecipientType;

  /**
   * قائمة IDs الموظفين المحددين (عند recipientType = SPECIFIC_EMPLOYEES)
   */
  @Column({ type: 'simple-json', nullable: true })
  specificEmployeeIds: string[] | null;

  /**
   * الأدوار المستهدفة (عند recipientType = BY_ROLE)
   * مثال: ['support', 'manager', 'warehouse']
   */
  @Column({ type: 'simple-json', nullable: true })
  targetRoles: string[] | null;

  /**
   * أرقام واتساب مخصصة (عند recipientType = CUSTOM_PHONES)
   * مثال: ['+966501234567', '+966509876543']
   */
  @Column({ type: 'simple-json', nullable: true })
  customPhones: string[] | null;

  /**
   * إيميلات مخصصة (عند recipientType = CUSTOM_EMAILS)
   * مثال: ['manager@store.com', 'owner@store.com']
   */
  @Column({ type: 'simple-json', nullable: true })
  customEmails: string[] | null;

  /**
   * قالب رسالة الإشعار الداخلي (Dashboard)
   * يدعم متغيرات مثل: {اسم_الموظف} {رقم_الطلب} {رابط_الطلب}
   */
  @Column({ type: 'text', nullable: true })
  dashboardTemplate: string | null;

  /**
   * عنوان الإشعار الداخلي
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  dashboardTitle: string | null;

  /**
   * قالب رسالة البريد الإلكتروني
   */
  @Column({ type: 'text', nullable: true })
  emailTemplate: string | null;

  /**
   * عنوان البريد الإلكتروني
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  emailSubject: string | null;

  /**
   * قالب رسالة الواتساب
   */
  @Column({ type: 'text', nullable: true })
  whatsappTemplate: string | null;

  /**
   * فقرة تحفيزية من التاجر (تظهر تحت "فريق رفيق يقولك:")
   * إذا فارغة يُستخدم النص الافتراضي
   */
  @Column({ type: 'text', nullable: true })
  motivationalMessage: string | null;

  /**
   * شروط إضافية (JSON)
   * مثال: { "afterHour": 21, "beforeHour": 6 } للتنبيهات بعد ساعة معينة
   * مثال: { "minOrderAmount": 500 } للطلبات فوق مبلغ معين
   * مثال: { "ratingBelow": 3 } للتقييمات السلبية
   */
  @Column({ type: 'simple-json', nullable: true })
  conditions: Record<string, unknown> | null;

  /**
   * هل القاعدة مُفعّلة؟
   */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /**
   * أولوية التنبيه (1 = عاجل، 5 = عادي)
   */
  @Column({ type: 'int', default: 3 })
  priority: number;

  /**
   * عدد التنبيهات المُرسلة بهذه القاعدة
   */
  @Column({ type: 'int', default: 0 })
  sentCount: number;

  /**
   * آخر مرة تم إرسال تنبيه بهذه القاعدة
   */
  @Column({ type: 'timestamp', nullable: true })
  lastTriggeredAt: Date | null;

  /**
   * ID المستخدم الذي أنشأ القاعدة
   */
  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
