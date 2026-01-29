/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Message Template Entity                    ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Entity يمثل قوالب الرسائل                                         ║
 * ║  القوالب هي رسائل معدّة مسبقاً يمكن إعادة استخدامها                           ║
 * ║                                                                                ║
 * ║  الفائدة من القوالب:                                                          ║
 * ║  - توفير الوقت (لا تكتب نفس الرسالة كل مرة)                                  ║
 * ║  - اتساق الرسائل (نفس الأسلوب والتنسيق)                                       ║
 * ║  - ضرورة لـ WhatsApp Business API (Template Messages)                        ║
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
  /** النص (إذا كان نصي) */
  text?: string;
  /** رابط الميديا */
  mediaUrl?: string;
  /** مثال للميديا (للمراجعة) */
  example?: string;
}

/**
 * 📌 TemplateButton - زر في القالب
 */
export interface TemplateButton {
  type: ButtonType;
  text: string;
  /** الرابط (للـ URL) */
  url?: string;
  /** رقم الهاتف */
  phoneNumber?: string;
  /** الكود (للنسخ) */
  code?: string;
  /** مثال (للمتغيرات) */
  example?: string;
}

/**
 * 📌 TemplateVariable - متغير في القالب
 * 
 * مثال: {{customer_name}}, {{order_id}}, {{total}}
 */
export interface TemplateVariable {
  /** اسم المتغير */
  name: string;
  /** الموقع (header, body, button) */
  location: 'header' | 'body' | 'button';
  /** رقم الموقع */
  position: number;
  /** نوع البيانات المتوقع */
  type: 'text' | 'number' | 'date' | 'currency' | 'url';
  /** مثال */
  example: string;
  /** القيمة الافتراضية */
  defaultValue?: string;
}

/**
 * 📌 WhatsAppApproval - معلومات موافقة واتساب
 */
export interface WhatsAppApproval {
  /** معرف القالب في واتساب */
  whatsappTemplateId?: string;
  /** اسم القالب في واتساب */
  whatsappTemplateName?: string;
  /** حالة الموافقة */
  status: 'pending' | 'approved' | 'rejected';
  /** تاريخ الإرسال للمراجعة */
  submittedAt?: string;
  /** تاريخ الرد */
  respondedAt?: string;
  /** سبب الرفض */
  rejectionReason?: string;
}

/**
 * 📌 TemplateStats - إحصائيات القالب
 */
export interface TemplateStats {
  /** عدد مرات الاستخدام */
  usageCount: number;
  /** آخر استخدام */
  lastUsedAt?: string;
  /** معدل التوصيل */
  deliveryRate?: number;
  /** معدل القراءة */
  readRate?: number;
  /** معدل الرد */
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
   * 👤 Created By
   */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📝 BASIC INFO
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📛 Name - اسم القالب (فريد لكل tenant)
   * 
   * مثال: "order_confirmation_ar", "welcome_message"
   */
  @Column({
    type: 'varchar',
    length: 100,
    comment: 'اسم القالب الفريد',
  })
  name: string;

  /**
   * 🏷️ Display Name - الاسم المعروض
   * 
   * مثال: "تأكيد الطلب", "رسالة ترحيب"
   */
  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    comment: 'الاسم المعروض للمستخدم',
  })
  displayName: string;

  /**
   * 📝 Description - وصف القالب
   */
  @Column({
    type: 'text',
    nullable: true,
    comment: 'وصف القالب',
  })
  description?: string;

  /**
   * 🗂️ Category - التصنيف
   */
  @Column({
    type: 'enum',
    enum: TemplateCategory,
    default: TemplateCategory.GENERAL,
    comment: 'تصنيف القالب',
  })
  category: TemplateCategory;

  /**
   * 📱 Channel - القناة
   */
  @Column({
    type: 'enum',
    enum: TemplateChannel,
    comment: 'القناة المستهدفة',
  })
  channel: TemplateChannel;

  /**
   * 🌐 Language - اللغة
   */
  @Column({
    type: 'enum',
    enum: TemplateLanguage,
    default: TemplateLanguage.AR,
    comment: 'لغة القالب',
  })
  language: TemplateLanguage;

  /**
   * 🚦 Status - الحالة
   */
  @Column({
    type: 'enum',
    enum: TemplateStatus,
    default: TemplateStatus.DRAFT,
    comment: 'حالة القالب',
  })
  status: TemplateStatus;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              💬 CONTENT
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 🎨 Header - هيدر الرسالة
   * 
   * اختياري - يمكن أن يكون نص أو صورة أو فيديو أو مستند
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'هيدر الرسالة',
  })
  header?: TemplateHeader;

  /**
   * 📝 Body - نص الرسالة الرئيسي
   * 
   * يدعم المتغيرات بصيغة {{variable_name}}
   * 
   * مثال:
   * "مرحباً {{customer_name}}! 👋
   * شكراً على طلبك رقم {{order_id}}.
   * المجموع: {{total}} ريال"
   */
  @Column({
    type: 'text',
    comment: 'نص الرسالة الرئيسي',
  })
  body: string;

  /**
   * 📎 Footer - ذيل الرسالة
   * 
   * نص صغير في الأسفل (اختياري)
   */
  @Column({
    type: 'varchar',
    length: 60,
    nullable: true,
    comment: 'ذيل الرسالة',
  })
  footer?: string;

  /**
   * 🔘 Buttons - الأزرار
   * 
   * حد أقصى 3 أزرار لـ WhatsApp
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: [],
    comment: 'أزرار الرسالة',
  })
  buttons: TemplateButton[];

  /**
   * 🔤 Variables - المتغيرات المستخدمة
   * 
   * قائمة بكل المتغيرات في القالب
   */
  @Column({
    type: 'jsonb',
    default: [],
    comment: 'المتغيرات المستخدمة',
  })
  variables: TemplateVariable[];

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📱 WHATSAPP SPECIFIC
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📱 WhatsApp Approval - معلومات موافقة واتساب
   * 
   * WhatsApp Business API يتطلب موافقة على القوالب قبل استخدامها
   */
  @Column({
    name: 'whatsapp_approval',
    type: 'jsonb',
    nullable: true,
    comment: 'معلومات موافقة واتساب',
  })
  whatsAppApproval?: WhatsAppApproval;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              📊 STATS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /**
   * 📊 Stats - إحصائيات الاستخدام
   */
  @Column({
    type: 'jsonb',
    default: { usageCount: 0 },
    comment: 'إحصائيات الاستخدام',
  })
  stats: TemplateStats;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *                              🔗 RELATIONS
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         📚 TEMPLATE VARIABLES GUIDE                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════════╣
 * ║                                                                                ║
 * ║  🔤 المتغيرات المتاحة:                                                         ║
 * ║  ═════════════════════                                                         ║
 * ║                                                                                ║
 * ║  👤 بيانات العميل:                                                             ║
 * ║  - {{customer_name}} - اسم العميل                                             ║
 * ║  - {{customer_first_name}} - الاسم الأول                                      ║
 * ║  - {{customer_phone}} - رقم الهاتف                                            ║
 * ║  - {{customer_email}} - الإيميل                                               ║
 * ║                                                                                ║
 * ║  📦 بيانات الطلب:                                                              ║
 * ║  - {{order_id}} - رقم الطلب                                                   ║
 * ║  - {{order_total}} - المجموع                                                  ║
 * ║  - {{order_status}} - حالة الطلب                                              ║
 * ║  - {{order_date}} - تاريخ الطلب                                               ║
 * ║  - {{shipping_address}} - عنوان الشحن                                         ║
 * ║  - {{tracking_number}} - رقم التتبع                                           ║
 * ║  - {{tracking_url}} - رابط التتبع                                             ║
 * ║                                                                                ║
 * ║  🏪 بيانات المتجر:                                                             ║
 * ║  - {{store_name}} - اسم المتجر                                                ║
 * ║  - {{store_url}} - رابط المتجر                                                ║
 * ║  - {{store_phone}} - هاتف المتجر                                              ║
 * ║                                                                                ║
 * ║  🛒 السلة المتروكة:                                                            ║
 * ║  - {{cart_total}} - مجموع السلة                                               ║
 * ║  - {{cart_items_count}} - عدد المنتجات                                        ║
 * ║  - {{cart_url}} - رابط السلة                                                  ║
 * ║                                                                                ║
 * ║  ═══════════════════════════════════════════════════════════════════════════  ║
 * ║                                                                                ║
 * ║  📱 متطلبات WhatsApp Business API:                                            ║
 * ║  ═══════════════════════════════════                                           ║
 * ║                                                                                ║
 * ║  1. يجب إرسال القالب للمراجعة قبل الاستخدام                                   ║
 * ║  2. المراجعة تأخذ 24-48 ساعة                                                  ║
 * ║  3. القوالب الترويجية لها شروط صارمة                                          ║
 * ║  4. يجب توفير أمثلة لكل متغير                                                 ║
 * ║  5. الحد الأقصى للنص: 1024 حرف                                                ║
 * ║  6. الحد الأقصى للأزرار: 3                                                    ║
 * ║                                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
