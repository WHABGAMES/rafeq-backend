/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Message Template Entity                    ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Entity يمثل قوالب الرسائل                                         ║
 * ║  القوالب هي رسائل معدّة مسبقاً يمكن إعادة استخدامها                           ║
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

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🏷️ TYPES & ENUMS                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/**
 * 📌 TemplateCategory - تصنيف القالب
 * ✅ تم تغييرها من enum إلى string constants للمرونة
 */
export enum TemplateCategory {
  /** ترحيب */
  WELCOME = 'welcome',
  /** تأكيد الطلب */
  ORDER_CONFIRMATION = 'order_confirmation',
  /** تحديث الشحن */
  SHIPPING_UPDATE = 'shipping_update',
  /** تأكيد التوصيل */
  DELIVERY_CONFIRMATION = 'delivery_confirmation',
  /** تذكير السلة المتروكة */
  ABANDONED_CART = 'abandoned_cart',
  /** عرض ترويجي */
  PROMOTIONAL = 'promotional',
  /** تذكير */
  REMINDER = 'reminder',
  /** استطلاع رأي */
  FEEDBACK = 'feedback',
  /** دعم فني */
  SUPPORT = 'support',
  /** عام */
  GENERAL = 'general',
  // ✅ إضافة التصنيفات الجديدة للقوالب الجاهزة
  ORDER_NOTIFICATIONS = 'order_notifications',
  SHIPPING_NOTIFICATIONS = 'shipping_notifications',
  SALES_RECOVERY = 'sales_recovery',
  MARKETING = 'marketing',
  ENGAGEMENT = 'engagement',
  SERVICE = 'service',
}

/**
 * 📌 TemplateStatus - حالة القالب
 */
export enum TemplateStatus {
  /** مسودة */
  DRAFT = 'draft',
  /** قيد المراجعة (WhatsApp) */
  PENDING_APPROVAL = 'pending_approval',
  /** معتمد */
  APPROVED = 'approved',
  /** مرفوض */
  REJECTED = 'rejected',
  /** نشط */
  ACTIVE = 'active',
  /** معطل */
  DISABLED = 'disabled',
}

/**
 * 📌 TemplateChannel - القناة
 */
export enum TemplateChannel {
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
  EMAIL = 'email',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
}

/**
 * 📌 TemplateLanguage - لغة القالب
 */
export enum TemplateLanguage {
  AR = 'ar',
  EN = 'en',
  AR_SA = 'ar_SA',
  EN_US = 'en_US',
}

/**
 * 📌 HeaderType - نوع الهيدر
 */
export enum HeaderType {
  NONE = 'none',
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
}

/**
 * 📌 ButtonType - نوع الزر
 */
export enum ButtonType {
  /** رد سريع */
  QUICK_REPLY = 'quick_reply',
  /** رابط */
  URL = 'url',
  /** رقم هاتف */
  PHONE = 'phone',
  /** نسخ كود */
  COPY_CODE = 'copy_code',
}

/**
 * 📌 TemplateHeader - هيدر القالب
 */
export interface TemplateHeader {
  type: HeaderType;
  text?: string;
  mediaUrl?: string;
  example?: string;
}

/**
 * 📌 TemplateButton - زر في القالب
 */
export interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  code?: string;
  example?: string;
}

/**
 * 📌 TemplateVariable - متغير في القالب
 */
export interface TemplateVariable {
  name: string;
  location: 'header' | 'body' | 'button';
  position: number;
  type: 'text' | 'number' | 'date' | 'currency' | 'url';
  example: string;
  defaultValue?: string;
}

/**
 * 📌 WhatsAppApproval - معلومات موافقة واتساب
 */
export interface WhatsAppApproval {
  whatsappTemplateId?: string;
  whatsappTemplateName?: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt?: string;
  respondedAt?: string;
  rejectionReason?: string;
}

/**
 * 📌 TemplateStats - إحصائيات القالب
 */
export interface TemplateStats {
  usageCount: number;
  lastUsedAt?: string;
  deliveryRate?: number;
  readRate?: number;
  replyRate?: number;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🗃️ MESSAGE TEMPLATE ENTITY                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
@Entity('message_templates')
@Index(['tenantId', 'channel', 'status'])
@Index(['tenantId', 'category'])
@Index(['tenantId', 'name'], { unique: true })
export class MessageTemplate extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({
    type: 'varchar',
    length: 100,
    comment: 'اسم القالب الفريد',
  })
  name: string;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    comment: 'الاسم المعروض للمستخدم',
  })
  displayName: string;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'وصف القالب',
  })
  description?: string;

  /**
   * ✅ تم تغيير category من enum إلى varchar
   * لدعم كل التصنيفات بدون migration
   */
  @Column({
    type: 'varchar',
    length: 100,
    default: 'general',
    comment: 'تصنيف القالب',
  })
  category: string;

  @Column({
    type: 'enum',
    enum: TemplateChannel,
    default: TemplateChannel.WHATSAPP,
    comment: 'القناة المستهدفة',
  })
  channel: TemplateChannel;

  @Column({
    type: 'enum',
    enum: TemplateLanguage,
    default: TemplateLanguage.AR,
    comment: 'لغة القالب',
  })
  language: TemplateLanguage;

  @Column({
    type: 'enum',
    enum: TemplateStatus,
    default: TemplateStatus.DRAFT,
    comment: 'حالة القالب',
  })
  status: TemplateStatus;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'هيدر الرسالة',
  })
  header?: TemplateHeader;

  @Column({
    type: 'text',
    comment: 'نص الرسالة الرئيسي',
  })
  body: string;

  @Column({
    type: 'varchar',
    length: 60,
    nullable: true,
    comment: 'ذيل الرسالة',
  })
  footer?: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: [],
    comment: 'أزرار الرسالة',
  })
  buttons: TemplateButton[];

  @Column({
    type: 'jsonb',
    default: [],
    comment: 'المتغيرات المستخدمة',
  })
  variables: TemplateVariable[];

  @Column({
    name: 'whatsapp_approval',
    type: 'jsonb',
    nullable: true,
    comment: 'معلومات موافقة واتساب',
  })
  whatsAppApproval?: WhatsAppApproval;

  @Column({
    type: 'jsonb',
    default: { usageCount: 0 },
    comment: 'إحصائيات الاستخدام',
  })
  stats: TemplateStats;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
