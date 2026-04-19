/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  NotificationService — Admin Notification Template System (v3)           ║
 * ║                                                                          ║
 * ║  Production-grade multi-tenant SaaS (10,000+ merchants)                  ║
 * ║                                                                          ║
 * ║  CHANGES v3 (2026-04):                                                   ║
 * ║   • Soft delete (deleted_at) — لا حذف نهائي                              ║
 * ║   • Usage tracking (sent_count, last_sent_at)                            ║
 * ║   • Rich events/variables metadata endpoints                             ║
 * ║   • Bulk toggle + duplicate                                              ║
 * ║   • Idempotent smart seed (per row NOT EXISTS)                           ║
 * ║   • 10 new professional templates (AR + EN, WhatsApp + Email)            ║
 * ║   • Version history كامل مع actor tracking                              ║
 * ║                                                                          ║
 * ║  SECURITY:                                                               ║
 * ║   • Table isolated from merchant 'message_templates'                    ║
 * ║   • All queries bounded to admin_notification_templates                  ║
 * ║   • Soft delete prevents accidental loss                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository, DataSource, IsNull } from 'typeorm';
import { Queue } from 'bullmq';
import {
  MessageTemplate,
  TriggerEvent,
  MessageLanguage,
  MessageChannel,
} from '../entities/message-template.entity';

export interface TemplateVariables {
  merchant_name?: string;
  email?: string;
  login_url?: string;
  temporary_password?: string;
  plan_name?: string;
  expiry_date?: string;
  payment_amount?: string;
  reset_link?: string;
  support_phone?: string;
  support_email?: string;
  invoice_url?: string;
  current_date?: string;
  current_year?: string;
  [key: string]: string | undefined;
}

// ─── Metadata definitions ──────────────────────────────────────────────────

export interface TriggerEventMeta {
  value: TriggerEvent;
  label: string;
  labelEn: string;
  icon: string;
  description: string;
  category: 'onboarding' | 'billing' | 'account' | 'marketing';
  suggestedVariables: string[];
}

export interface VariableMeta {
  key: string;
  label: string;
  labelEn: string;
  category: 'merchant' | 'auth' | 'subscription' | 'support' | 'dates' | 'channel';
  sample: string;
}

// Global definitions — single source of truth for frontend/backend
const TRIGGER_EVENTS: TriggerEventMeta[] = [
  {
    value: TriggerEvent.NEW_MERCHANT_REGISTERED,
    label: 'تاجر جديد مسجّل',
    labelEn: 'New Merchant Registered',
    icon: '👤',
    description: 'يُرسَل تلقائياً عند إنشاء حساب تاجر جديد',
    category: 'onboarding',
    suggestedVariables: ['merchant_name', 'email', 'temporary_password', 'login_url'],
  },
  {
    value: TriggerEvent.WELCOME_MESSAGE,
    label: 'ترحيب بالتاجر',
    labelEn: 'Welcome Message',
    icon: '🎉',
    description: 'رسالة ترحيب قابلة للتخصيص (مختلفة عن رسالة التسجيل)',
    category: 'onboarding',
    suggestedVariables: ['merchant_name', 'login_url', 'support_phone'],
  },
  {
    value: TriggerEvent.SUBSCRIPTION_EXPIRING,
    label: 'اشتراك على وشك الانتهاء',
    labelEn: 'Subscription Expiring',
    icon: '⚠️',
    description: 'تذكير قبل انتهاء الاشتراك بأيام',
    category: 'billing',
    suggestedVariables: ['merchant_name', 'plan_name', 'expiry_date', 'login_url'],
  },
  {
    value: TriggerEvent.SUBSCRIPTION_EXPIRED,
    label: 'اشتراك منتهٍ',
    labelEn: 'Subscription Expired',
    icon: '❌',
    description: 'يُرسَل لحظة انتهاء الاشتراك',
    category: 'billing',
    suggestedVariables: ['merchant_name', 'plan_name', 'login_url', 'support_phone'],
  },
  {
    value: TriggerEvent.PAYMENT_RECEIVED,
    label: 'تم استلام الدفعة',
    labelEn: 'Payment Received',
    icon: '💳',
    description: 'تأكيد استلام دفعة اشتراك',
    category: 'billing',
    suggestedVariables: ['merchant_name', 'payment_amount', 'plan_name', 'invoice_url'],
  },
  {
    value: TriggerEvent.ACCOUNT_SUSPENDED,
    label: 'تم إيقاف الحساب',
    labelEn: 'Account Suspended',
    icon: '🚫',
    description: 'إشعار إيقاف الحساب مع وسيلة تواصل',
    category: 'account',
    suggestedVariables: ['merchant_name', 'support_phone', 'support_email'],
  },
  {
    value: TriggerEvent.WHATSAPP_DISCONNECTED,
    label: 'انفصال الواتساب',
    labelEn: 'WhatsApp Disconnected',
    icon: '🔌',
    description: 'إشعار عند انفصال الواتساب المربوط بمتجر التاجر (logout من الجوال / استبدال الجلسة)',
    category: 'account',
    suggestedVariables: ['merchant_name', 'channel_name', 'reason_label', 'login_url', 'support_phone'],
  },
  {
    value: TriggerEvent.CUSTOM_MANUAL_SEND,
    label: 'إرسال يدوي مخصّص',
    labelEn: 'Custom Manual Send',
    icon: '📤',
    description: 'قوالب للإرسال اليدوي (عروض، إعلانات، صيانة)',
    category: 'marketing',
    suggestedVariables: ['merchant_name', 'current_date', 'login_url'],
  },
];

const AVAILABLE_VARIABLES: VariableMeta[] = [
  // Merchant
  { key: 'merchant_name',      label: 'اسم التاجر',              labelEn: 'Merchant Name',      category: 'merchant',    sample: 'أحمد محمد' },
  { key: 'email',              label: 'البريد الإلكتروني',        labelEn: 'Email',              category: 'merchant',    sample: 'ahmed@example.com' },
  // Auth
  { key: 'temporary_password', label: 'كلمة المرور المؤقتة',     labelEn: 'Temporary Password', category: 'auth',        sample: 'Temp@12345' },
  { key: 'login_url',          label: 'رابط الدخول',              labelEn: 'Login URL',          category: 'auth',        sample: 'https://app.rafeq.ai/auth/login' },
  { key: 'reset_link',         label: 'رابط استعادة كلمة المرور', labelEn: 'Reset Link',         category: 'auth',        sample: 'https://app.rafeq.ai/auth/reset' },
  // Subscription
  { key: 'plan_name',          label: 'اسم الخطة',                labelEn: 'Plan Name',          category: 'subscription', sample: 'خطة برو' },
  { key: 'expiry_date',        label: 'تاريخ الانتهاء',           labelEn: 'Expiry Date',        category: 'subscription', sample: '2026-05-31' },
  { key: 'payment_amount',     label: 'قيمة الدفعة',              labelEn: 'Payment Amount',     category: 'subscription', sample: '299 ريال' },
  { key: 'invoice_url',        label: 'رابط الفاتورة',            labelEn: 'Invoice URL',        category: 'subscription', sample: 'https://app.rafeq.ai/invoices/123' },
  // Support
  { key: 'support_phone',      label: 'رقم الدعم',                labelEn: 'Support Phone',      category: 'support',     sample: '+966500000000' },
  { key: 'support_email',      label: 'بريد الدعم',               labelEn: 'Support Email',      category: 'support',     sample: 'support@rafeq.ai' },
  // WhatsApp channel
  { key: 'channel_name',       label: 'اسم القناة',               labelEn: 'Channel Name',       category: 'channel',     sample: 'واتساب المتجر الرئيسي' },
  { key: 'reason_label',       label: 'سبب الانفصال',             labelEn: 'Disconnect Reason',  category: 'channel',     sample: 'تم تسجيل الخروج من الجوال' },
  // Dates
  { key: 'current_date',       label: 'التاريخ الحالي',           labelEn: 'Current Date',       category: 'dates',       sample: '2026-04-19' },
  { key: 'current_year',       label: 'السنة الحالية',            labelEn: 'Current Year',       category: 'dates',       sample: '2026' },
];

// ─── Seed templates (professional, production-ready) ───────────────────────

interface SeedTemplate {
  name: string;
  trigger_event: TriggerEvent;
  channel: MessageChannel;
  language: MessageLanguage;
  content: string;
  subject?: string;
}

const SEED_TEMPLATES: SeedTemplate[] = [
  // ─── NEW_MERCHANT_REGISTERED ────────────────────────────────────────────
  {
    name: 'مرحباً بالتاجر الجديد',
    trigger_event: TriggerEvent.NEW_MERCHANT_REGISTERED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 👋

تم إنشاء حسابك في منصة رفيق AI بنجاح ✅

🔐 بيانات الدخول:
📧 البريد: {{email}}
🔑 كلمة المرور المؤقتة: {{temporary_password}}

🔗 رابط الدخول:
{{login_url}}

⚠️ يُنصح بتغيير كلمة المرور بعد أول تسجيل دخول

فريق رفيق AI يتمنى لك تجربة ناجحة 🚀`,
  },
  {
    name: 'Welcome New Merchant',
    trigger_event: TriggerEvent.NEW_MERCHANT_REGISTERED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hello {{merchant_name}} 👋

Your account on Rafeq AI has been created successfully ✅

🔐 Login Details:
📧 Email: {{email}}
🔑 Temporary Password: {{temporary_password}}

🔗 Login URL: {{login_url}}

⚠️ We recommend changing your password after first login

Rafeq AI Team 🚀`,
  },
  {
    name: 'بريد ترحيبي - تاجر جديد',
    trigger_event: TriggerEvent.NEW_MERCHANT_REGISTERED,
    channel: MessageChannel.EMAIL,
    language: MessageLanguage.AR,
    subject: 'مرحباً بك في رفيق AI — بيانات الدخول',
    content: `مرحباً {{merchant_name}}،

يسعدنا انضمامك إلى منصة رفيق AI — منصة أتمتة التواصل الذكية للتجار.

بيانات حسابك:
• البريد: {{email}}
• كلمة المرور المؤقتة: {{temporary_password}}
• رابط الدخول: {{login_url}}

لأمانك، نوصي بتغيير كلمة المرور فور دخولك.

إذا احتجت مساعدة، فريق الدعم متاح على {{support_email}}.

مع التحية،
فريق رفيق AI`,
  },

  // ─── WELCOME_MESSAGE ────────────────────────────────────────────────────
  {
    name: 'رسالة ترحيب',
    trigger_event: TriggerEvent.WELCOME_MESSAGE,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `أهلاً {{merchant_name}} 🎉

يسعدنا وجودك معنا في عائلة رفيق AI!

منصتنا هتساعدك توصّل لعملائك بشكل أذكى وأسرع عبر:
✅ أتمتة الطلبات والشحنات
✅ استرداد السلات المتروكة
✅ ردود AI تلقائية على عملائك
✅ حملات تسويقية متقدمة

تقدر تبدأ من لوحة التحكم:
{{login_url}}

أي استفسار؟ كلّمنا على {{support_phone}} 💙`,
  },
  {
    name: 'Welcome Message',
    trigger_event: TriggerEvent.WELCOME_MESSAGE,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hi {{merchant_name}} 🎉

Welcome to the Rafeq AI family!

Our platform helps you reach customers smarter and faster with:
✅ Order & shipment automation
✅ Abandoned cart recovery
✅ AI-powered customer replies
✅ Advanced marketing campaigns

Get started from your dashboard:
{{login_url}}

Need help? Reach us at {{support_phone}} 💙`,
  },

  // ─── SUBSCRIPTION_EXPIRING ──────────────────────────────────────────────
  {
    name: 'اشتراك على وشك الانتهاء',
    trigger_event: TriggerEvent.SUBSCRIPTION_EXPIRING,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 👋

⏰ تذكير مهم: اشتراكك في خطة {{plan_name}} سينتهي في {{expiry_date}}.

لتجنب انقطاع الخدمة وفقدان وصول عملائك للمنصة، يرجى تجديد اشتراكك الآن:

🔗 {{login_url}}

عند انتهاء الاشتراك:
❌ تتوقف الإشعارات التلقائية
❌ تتوقف ردود AI
❌ تتوقف حملات التسويق

للاستفسار: {{support_phone}}

فريق رفيق AI 💙`,
  },
  {
    name: 'Subscription Expiring Soon',
    trigger_event: TriggerEvent.SUBSCRIPTION_EXPIRING,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hi {{merchant_name}} 👋

⏰ Important reminder: Your {{plan_name}} subscription expires on {{expiry_date}}.

To avoid service interruption, please renew your subscription now:

🔗 {{login_url}}

When subscription expires:
❌ Automated notifications stop
❌ AI replies stop
❌ Marketing campaigns stop

Questions? Contact us at {{support_phone}}

Rafeq AI Team 💙`,
  },
  {
    name: 'بريد تجديد الاشتراك',
    trigger_event: TriggerEvent.SUBSCRIPTION_EXPIRING,
    channel: MessageChannel.EMAIL,
    language: MessageLanguage.AR,
    subject: '⏰ اشتراكك ينتهي قريباً — {{expiry_date}}',
    content: `مرحباً {{merchant_name}}،

نود تذكيرك بأن اشتراكك في خطة {{plan_name}} سينتهي بتاريخ {{expiry_date}}.

يرجى تجديد اشتراكك قبل ذلك التاريخ لضمان استمرار الخدمة دون انقطاع.

رابط التجديد: {{login_url}}

للاستفسار: {{support_email}}

فريق رفيق AI`,
  },

  // ─── SUBSCRIPTION_EXPIRED ───────────────────────────────────────────────
  {
    name: 'انتهى اشتراكك',
    trigger_event: TriggerEvent.SUBSCRIPTION_EXPIRED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 👋

انتهى اشتراكك في خطة {{plan_name}} اليوم.

🔒 تم إيقاف الخدمات التالية مؤقتاً:
• الإشعارات التلقائية
• ردود AI الذكية
• حملات التسويق

💡 بياناتك محفوظة بالكامل — ما تقلق!

لاستعادة الخدمة فوراً، جدّد اشتراكك من:
🔗 {{login_url}}

نحن هنا لمساعدتك: {{support_phone}}

فريق رفيق AI 💙`,
  },
  {
    name: 'Subscription Expired',
    trigger_event: TriggerEvent.SUBSCRIPTION_EXPIRED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hi {{merchant_name}} 👋

Your {{plan_name}} subscription has expired today.

🔒 The following services are temporarily paused:
• Automated notifications
• AI smart replies
• Marketing campaigns

💡 Your data is fully preserved — no worries!

To restore service instantly, renew from:
🔗 {{login_url}}

We're here to help: {{support_phone}}

Rafeq AI Team 💙`,
  },

  // ─── PAYMENT_RECEIVED ───────────────────────────────────────────────────
  {
    name: 'تم استلام الدفعة',
    trigger_event: TriggerEvent.PAYMENT_RECEIVED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 👋

✅ تم استلام دفعتك بنجاح!

💰 المبلغ: {{payment_amount}}
📦 الخطة: {{plan_name}}
📅 تاريخ التفعيل: {{current_date}}

🎉 اشتراكك نشط الآن وجميع الخدمات متاحة.

📄 تحميل الفاتورة:
{{invoice_url}}

شكراً لثقتك — فريق رفيق AI 💙`,
  },
  {
    name: 'Payment Received',
    trigger_event: TriggerEvent.PAYMENT_RECEIVED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hi {{merchant_name}} 👋

✅ Payment received successfully!

💰 Amount: {{payment_amount}}
📦 Plan: {{plan_name}}
📅 Activated: {{current_date}}

🎉 Your subscription is now active and all services are available.

📄 Download invoice:
{{invoice_url}}

Thank you — Rafeq AI Team 💙`,
  },
  {
    name: 'بريد استلام الدفعة',
    trigger_event: TriggerEvent.PAYMENT_RECEIVED,
    channel: MessageChannel.EMAIL,
    language: MessageLanguage.AR,
    subject: '✅ تم استلام دفعتك — {{payment_amount}}',
    content: `مرحباً {{merchant_name}}،

شكراً لك. تم استلام دفعتك بنجاح.

تفاصيل الدفعة:
• المبلغ: {{payment_amount}}
• الخطة: {{plan_name}}
• التاريخ: {{current_date}}

رابط الفاتورة: {{invoice_url}}

اشتراكك نشط الآن وجميع الخدمات متاحة.

مع التحية،
فريق رفيق AI`,
  },

  // ─── ACCOUNT_SUSPENDED ──────────────────────────────────────────────────
  {
    name: 'تم إيقاف الحساب',
    trigger_event: TriggerEvent.ACCOUNT_SUSPENDED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 👋

تم إيقاف حسابك في منصة رفيق AI مؤقتاً.

🔒 الوصول للمنصة متوقف حالياً.

للاستفسار أو الحصول على تفاصيل الإيقاف، يرجى التواصل مع فريق الدعم:

📞 الهاتف: {{support_phone}}
📧 البريد: {{support_email}}

بياناتك محفوظة بالكامل.

فريق رفيق AI`,
  },
  {
    name: 'Account Suspended',
    trigger_event: TriggerEvent.ACCOUNT_SUSPENDED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hi {{merchant_name}} 👋

Your account on Rafeq AI has been temporarily suspended.

🔒 Platform access is currently paused.

For inquiries or suspension details, please contact our support team:

📞 Phone: {{support_phone}}
📧 Email: {{support_email}}

Your data is fully preserved.

Rafeq AI Team`,
  },

  // ─── WHATSAPP_DISCONNECTED ─────────────────────────────────────────────
  {
    name: 'تنبيه انفصال الواتساب',
    trigger_event: TriggerEvent.WHATSAPP_DISCONNECTED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 🔌

⚠️ *تم فصل الواتساب المربوط بمتجرك*

📱 القناة: {{channel_name}}
📌 السبب: {{reason_label}}

*ماذا يعني هذا؟*
لن يتمكّن عملاؤك من التواصل معك عبر واتساب المتجر حالياً، والرسائل الواردة لن تصل.

*الحل سريع ✅*
ادخل لوحة التحكم وأعد ربط الواتساب بمسح رمز QR من جوالك:
{{login_url}}

لو تواجه صعوبة، تواصل مع الدعم:
☎️ {{support_phone}}

— فريق رفيق AI`,
  },
  {
    name: 'WhatsApp Disconnected Alert',
    trigger_event: TriggerEvent.WHATSAPP_DISCONNECTED,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.EN,
    content: `Hello {{merchant_name}} 🔌

⚠️ *Your store's WhatsApp connection was disconnected*

📱 Channel: {{channel_name}}
📌 Reason: {{reason_label}}

*What does this mean?*
Your customers can't currently reach you via your store's WhatsApp, and incoming messages won't arrive.

*Quick fix ✅*
Log in to your dashboard and re-link WhatsApp by scanning the QR code from your phone:
{{login_url}}

If you need help, contact support:
☎️ {{support_phone}}

— Rafeq AI Team`,
  },

  // ─── CUSTOM_MANUAL_SEND (ready-to-use promotional templates) ────────────
  {
    name: 'إعلان صيانة مجدولة',
    trigger_event: TriggerEvent.CUSTOM_MANUAL_SEND,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 🔧

نعلمك بوجود عملية صيانة مجدولة للمنصة:

📅 التاريخ: {{current_date}}
⏱ المدة المتوقعة: 30 دقيقة

خلال فترة الصيانة قد تلاحظ بطء في الاستجابة.

نعتذر عن أي إزعاج وشكراً لتفهمك 💙

فريق رفيق AI`,
  },
  {
    name: 'عرض خاص للتجار',
    trigger_event: TriggerEvent.CUSTOM_MANUAL_SEND,
    channel: MessageChannel.WHATSAPP,
    language: MessageLanguage.AR,
    content: `مرحباً {{merchant_name}} 🎁

عرض حصري لك كتاجر متميز في رفيق AI!

🌟 احصل على ترقية مجانية لمدة شهر كامل
💎 جميع مزايا الخطة البرو متاحة

للاستفادة من العرض، ادخل لوحة التحكم:
{{login_url}}

العرض ساري لفترة محدودة ⏰

فريق رفيق AI 💙`,
  },
];

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private readonly loginUrl = process.env.FRONTEND_URL || 'https://app.rafeq.ai';
  private readonly supportPhone = process.env.SUPPORT_PHONE || '+966500000000';
  private readonly supportEmail = process.env.SUPPORT_EMAIL || 'support@rafeq.ai';

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── Schema migration + Seeds (idempotent) ──────────────────────────────
  async onModuleInit(): Promise<void> {
    try {
      // 1. Base table (IF NOT EXISTS)
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS admin_notification_templates (
          id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
          name            VARCHAR(255) NOT NULL,
          trigger_event   VARCHAR(100) NOT NULL,
          channel         VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
          language        VARCHAR(5)   NOT NULL DEFAULT 'ar',
          content         TEXT         NOT NULL,
          subject         VARCHAR(500),
          is_active       BOOLEAN      NOT NULL DEFAULT true,
          version_history JSONB        NOT NULL DEFAULT '[]',
          version         INT          NOT NULL DEFAULT 1,
          created_by      UUID         NOT NULL,
          updated_by      UUID,
          created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);

      // 2. Indexes
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_notif_event_channel_lang
          ON admin_notification_templates (trigger_event, channel, language, is_active)
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_notif_active
          ON admin_notification_templates (is_active)
      `);

      // 3. Additive columns (v3) — safe for existing installations
      await this.dataSource.query(`
        ALTER TABLE admin_notification_templates
        ADD COLUMN IF NOT EXISTS sent_count INT NOT NULL DEFAULT 0
      `);
      await this.dataSource.query(`
        ALTER TABLE admin_notification_templates
        ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ
      `);
      await this.dataSource.query(`
        ALTER TABLE admin_notification_templates
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_notif_deleted_at
          ON admin_notification_templates (deleted_at)
      `);

      // 4. Idempotent per-template seed — inserts only what's missing
      let seeded = 0;
      for (const tpl of SEED_TEMPLATES) {
        const result: Array<{ id: string }> = await this.dataSource.query(
          `
          INSERT INTO admin_notification_templates
            (name, trigger_event, channel, language, content, subject, created_by, is_active)
          SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::text, $6::varchar, $7::UUID, false
          WHERE NOT EXISTS (
            SELECT 1 FROM admin_notification_templates
            WHERE name = $1::varchar
              AND trigger_event = $2::varchar
              AND channel = $3::varchar
              AND language = $4::varchar
              AND deleted_at IS NULL
          )
          RETURNING id
          `,
          [
            tpl.name,
            tpl.trigger_event,
            tpl.channel,
            tpl.language,
            tpl.content,
            tpl.subject || null,
            '00000000-0000-0000-0000-000000000000',
          ],
        );
        if (result?.length) seeded++;
      }

      if (seeded > 0) {
        this.logger.log(`✅ admin_notification_templates: seeded ${seeded} new template(s)`);
      }
      this.logger.log('✅ admin_notification_templates: ready (v3)');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[onModuleInit] schema/seed failed: ${msg}`);
    }
  }

  // ─── Metadata endpoints ─────────────────────────────────────────────────

  getTriggerEvents(): TriggerEventMeta[] {
    return TRIGGER_EVENTS;
  }

  getAvailableVariables(): { groups: Record<string, VariableMeta[]>; all: VariableMeta[] } {
    const groups: Record<string, VariableMeta[]> = {};
    for (const v of AVAILABLE_VARIABLES) {
      if (!groups[v.category]) groups[v.category] = [];
      groups[v.category].push(v);
    }
    return { groups, all: AVAILABLE_VARIABLES };
  }

  // ─── Event-driven Send ──────────────────────────────────────────────────

  async sendByTriggerEvent(
    event: TriggerEvent,
    recipientPhone: string,
    variables: TemplateVariables,
    options?: {
      recipientUserId?: string;
      recipientEmail?: string;
      language?: MessageLanguage;
      tenantId?: string;
    },
  ): Promise<void> {
    const lang = options?.language || MessageLanguage.AR;

    // ✅ v3 FIX: ORDER BY createdAt ASC للسلوك الحتمي (deterministic)
    // إذا كان هناك قالبان لنفس (event, lang) بقنوات مختلفة (مثل WhatsApp + Email
    // بعد تركيب v3 على DB يحتوي قوالب v2)، نفضّل الأقدم الذي اعتاد النظام عليه.
    // هذا يحافظ على backward compatibility — قوالب v2 تبقى نشطة، قوالب v3 تتولى
    // الأحداث والقنوات الجديدة.
    const template = await this.templateRepo.findOne({
      where: {
        triggerEvent: event,
        isActive: true,
        language: lang,
        deletedAt: IsNull(),
      } as any,
      order: { createdAt: 'ASC' },
    });

    if (!template) {
      this.logger.warn(`No active template for event=${event} lang=${lang}`);
      return;
    }

    await this.notificationQueue.add(
      'send-notification',
      {
        templateId: template.id,
        content: this.injectVariables(template.content, variables),
        channel: template.channel,
        recipientPhone,
        recipientEmail: options?.recipientEmail,
        recipientUserId: options?.recipientUserId,
        triggerEvent: event,
        tenantId: options?.tenantId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Update usage stats (non-blocking — fire & forget)
    this.incrementUsage(template.id).catch((err) => {
      this.logger.warn(`Failed to increment usage for template ${template.id}: ${err.message}`);
    });
  }

  // ─── Manual Send ────────────────────────────────────────────────────────

  async sendManual(
    templateId: string,
    recipientPhone: string,
    variables: TemplateVariables,
    options?: { recipientUserId?: string; recipientEmail?: string; tenantId?: string },
  ): Promise<{ success: boolean; jobId: string }> {
    const template = await this.findTemplateOrFail(templateId);

    const job = await this.notificationQueue.add(
      'send-notification',
      {
        templateId,
        content: this.injectVariables(template.content, variables),
        channel: template.channel,
        recipientPhone,
        recipientEmail: options?.recipientEmail,
        recipientUserId: options?.recipientUserId,
        triggerEvent: TriggerEvent.CUSTOM_MANUAL_SEND,
        tenantId: options?.tenantId,
      },
      { attempts: 3 },
    );

    // ✅ v3: await في sendManual (admin action — accurate stats expected).
    // في sendByTriggerEvent نستخدم fire-and-forget (high volume, stale stats OK).
    await this.incrementUsage(templateId);

    return { success: true, jobId: job.id as string };
  }

  // ─── Template CRUD ──────────────────────────────────────────────────────

  async createTemplate(
    data: Partial<MessageTemplate>,
    adminId: string,
  ): Promise<MessageTemplate> {
    if (!data.name?.trim()) {
      throw new BadRequestException('اسم القالب مطلوب');
    }
    if (!data.content?.trim()) {
      throw new BadRequestException('محتوى القالب مطلوب');
    }
    if (!data.triggerEvent) {
      throw new BadRequestException('حدث التفعيل مطلوب');
    }

    const template = this.templateRepo.create({
      ...data,
      createdBy: adminId,
      version: 1,
      versionHistory: [],
    });
    const saved = await this.templateRepo.save(template);
    this.logger.log(`✅ Template created: id=${saved.id}, name="${saved.name}", event=${saved.triggerEvent}`);
    return saved;
  }

  async updateTemplate(
    id: string,
    data: Partial<MessageTemplate>,
    adminId: string,
  ): Promise<MessageTemplate> {
    const template = await this.findTemplateOrFail(id);

    // Track version only when content actually changes
    const contentChanged = data.content !== undefined && data.content !== template.content;

    if (contentChanged) {
      template.versionHistory = [
        ...(template.versionHistory || []),
        {
          version: template.version,
          content: template.content,
          updatedAt: new Date().toISOString(),
          updatedBy: adminId,
        },
      ].slice(-20); // Keep last 20 versions only (prevent unbounded growth)
      template.version++;
    }
    template.updatedBy = adminId;
    Object.assign(template, data);

    const saved = await this.templateRepo.save(template);
    this.logger.log(`📝 Template updated: id=${id}, version=${saved.version}, contentChanged=${contentChanged}`);
    return saved;
  }

  async getAllTemplates(filters?: {
    triggerEvent?: string;
    channel?: string;
    language?: string;
    isActive?: boolean;
    search?: string;
  }): Promise<MessageTemplate[]> {
    try {
      const qb = this.templateRepo
        .createQueryBuilder('t')
        .where('t.deleted_at IS NULL');

      if (filters?.triggerEvent) {
        qb.andWhere('t.trigger_event = :event', { event: filters.triggerEvent });
      }
      if (filters?.channel) {
        qb.andWhere('t.channel = :channel', { channel: filters.channel });
      }
      if (filters?.language) {
        qb.andWhere('t.language = :language', { language: filters.language });
      }
      if (filters?.isActive !== undefined) {
        qb.andWhere('t.is_active = :isActive', { isActive: filters.isActive });
      }
      if (filters?.search?.trim()) {
        qb.andWhere('(t.name ILIKE :q OR t.content ILIKE :q)', {
          q: `%${filters.search.trim()}%`,
        });
      }

      return await qb.orderBy('t.updated_at', 'DESC').getMany();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown DB error';
      this.logger.error(
        `[getAllTemplates] DB query failed: ${errorMsg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(`فشل تحميل القوالب: ${errorMsg}`);
    }
  }

  async getTemplateById(id: string): Promise<MessageTemplate> {
    return this.findTemplateOrFail(id);
  }

  /**
   * Soft delete — preserves data, allows recovery
   */
  async deleteTemplate(id: string, adminId: string): Promise<void> {
    const template = await this.findTemplateOrFail(id);
    await this.dataSource.query(
      `UPDATE admin_notification_templates
       SET deleted_at = NOW(), updated_by = $1, is_active = false
       WHERE id = $2`,
      [adminId, id],
    );
    this.logger.log(`🗑️ Template soft-deleted: id=${id}, name="${template.name}", by=${adminId}`);
  }

  async toggleTemplate(id: string, adminId: string): Promise<MessageTemplate> {
    const template = await this.findTemplateOrFail(id);
    template.isActive = !template.isActive;
    template.updatedBy = adminId;
    const saved = await this.templateRepo.save(template);
    this.logger.log(`🔄 Template toggled: id=${id}, active=${saved.isActive}`);
    return saved;
  }

  async bulkToggle(
    ids: string[],
    isActive: boolean,
    adminId: string,
  ): Promise<{ count: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('يجب تحديد قالب واحد على الأقل');
    }
    if (ids.length > 100) {
      throw new BadRequestException('الحد الأقصى 100 قالب في العملية الواحدة');
    }
    const result = await this.dataSource.query(
      `UPDATE admin_notification_templates
       SET is_active = $1, updated_by = $2, updated_at = NOW()
       WHERE id = ANY($3::UUID[]) AND deleted_at IS NULL`,
      [isActive, adminId, ids],
    );
    const count = result?.[1] || 0;
    this.logger.log(`🔄 Bulk toggle: ${count} template(s) → active=${isActive}`);
    return { count };
  }

  async duplicateTemplate(id: string, adminId: string): Promise<MessageTemplate> {
    const original = await this.findTemplateOrFail(id);
    const copy = this.templateRepo.create({
      name: `${original.name} (نسخة)`,
      triggerEvent: original.triggerEvent,
      channel: original.channel,
      language: original.language,
      content: original.content,
      subject: original.subject,
      isActive: false, // New copies start disabled
      version: 1,
      versionHistory: [],
      createdBy: adminId,
    });
    const saved = await this.templateRepo.save(copy);
    this.logger.log(`📋 Template duplicated: source=${id} → new=${saved.id}`);
    return saved;
  }

  async getTemplateStats(id: string): Promise<{
    id: string;
    name: string;
    sentCount: number;
    lastSentAt: string | null;
    version: number;
    versionHistory: MessageTemplate['versionHistory'];
  }> {
    const template = await this.findTemplateOrFail(id);
    const row: Array<{ sent_count: number; last_sent_at: string | null }> = await this.dataSource.query(
      `SELECT sent_count, last_sent_at FROM admin_notification_templates WHERE id = $1`,
      [id],
    );
    return {
      id: template.id,
      name: template.name,
      sentCount: row[0]?.sent_count ?? 0,
      lastSentAt: row[0]?.last_sent_at ?? null,
      version: template.version,
      versionHistory: template.versionHistory || [],
    };
  }

  async getOverviewStats(): Promise<{
    total: number;
    active: number;
    disabled: number;
    byChannel: Record<string, number>;
    byLanguage: Record<string, number>;
    byEvent: Record<string, number>;
  }> {
    const rows: Array<{
      channel: string;
      language: string;
      trigger_event: string;
      is_active: boolean;
      cnt: string;
    }> = await this.dataSource.query(
      `SELECT channel, language, trigger_event, is_active, COUNT(*)::int AS cnt
       FROM admin_notification_templates
       WHERE deleted_at IS NULL
       GROUP BY channel, language, trigger_event, is_active`,
    );

    let total = 0, active = 0, disabled = 0;
    const byChannel: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};
    const byEvent: Record<string, number> = {};

    for (const r of rows) {
      const cnt = Number(r.cnt) || 0;
      total += cnt;
      if (r.is_active) active += cnt; else disabled += cnt;
      byChannel[r.channel] = (byChannel[r.channel] || 0) + cnt;
      byLanguage[r.language] = (byLanguage[r.language] || 0) + cnt;
      byEvent[r.trigger_event] = (byEvent[r.trigger_event] || 0) + cnt;
    }

    return { total, active, disabled, byChannel, byLanguage, byEvent };
  }

  // ─── Variable Injection ─────────────────────────────────────────────────

  injectVariables(content: string, variables: TemplateVariables): string {
    let result = content;
    const now = new Date();
    const merged: TemplateVariables = {
      login_url: this.loginUrl,
      support_phone: this.supportPhone,
      support_email: this.supportEmail,
      current_date: now.toISOString().slice(0, 10),
      current_year: String(now.getFullYear()),
      ...variables,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== null) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      }
    }

    // Strip any leftover unfilled variables
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  previewTemplate(content: string, variables: TemplateVariables): string {
    return this.injectVariables(content, variables);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async findTemplateOrFail(id: string): Promise<MessageTemplate> {
    const template = await this.templateRepo.findOne({
      where: { id, deletedAt: IsNull() } as any,
    });
    if (!template) throw new NotFoundException(`القالب غير موجود: ${id}`);
    return template;
  }

  private async incrementUsage(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE admin_notification_templates
       SET sent_count = sent_count + 1, last_sent_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }
}
