import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: CreateAdminNotifTemplates1771800000000                      ║
 * ║                                                                          ║
 * ║  يُنشئ جدول admin_notification_templates المخصص للسوبر أدمن            ║
 * ║                                                                          ║
 * ║  WHY A NEW TABLE:                                                        ║
 * ║  جدول message_templates مستخدم من قِبَل منصة التجار (schema مختلف)     ║
 * ║  أعمدة التاجر: body, status, tenantId, displayName, category...         ║
 * ║  أعمدة الأدمن: content, triggerEvent, versionHistory, createdBy...      ║
 * ║  الخطأ السابق: column "content" does not exist                          ║
 * ║                                                                          ║
 * ║  الحل الجذري: جدول منفصل تماماً لإشعارات السوبر أدمن                  ║
 * ║  merchant message_templates → محفوظة بدون تعديل                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

export class CreateAdminNotifTemplates1771800000000 implements MigrationInterface {
  name = 'CreateAdminNotifTemplates1771800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ─── 1. Create admin_notification_templates ────────────────────────────
    // Uses VARCHAR for trigger_event/channel/language to avoid enum conflicts
    // with trigger_event_enum that may already exist in message_templates scope
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS admin_notification_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        trigger_event VARCHAR(100) NOT NULL,
        channel VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
        language VARCHAR(5) NOT NULL DEFAULT 'ar',
        content TEXT NOT NULL,
        subject VARCHAR(500),
        is_active BOOLEAN NOT NULL DEFAULT true,
        version_history JSONB NOT NULL DEFAULT '[]',
        version INT NOT NULL DEFAULT 1,
        created_by UUID NOT NULL,
        updated_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ─── 2. Create indexes ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_notif_trigger_channel_lang
        ON admin_notification_templates (trigger_event, channel, language, is_active);

      CREATE INDEX IF NOT EXISTS idx_admin_notif_template_active
        ON admin_notification_templates (is_active);
    `);

    // ─── 3. Seed default admin notification templates ─────────────────────
    // Only if no rows exist yet (idempotent seed)
    await queryRunner.query(`
      INSERT INTO admin_notification_templates 
        (name, trigger_event, channel, language, content, created_by)
      SELECT * FROM (VALUES
        (
          'مرحبا بالتاجر الجديد',
          'NEW_MERCHANT_REGISTERED',
          'whatsapp',
          'ar',
          'مرحبًا {{merchant_name}} 👋

تم إنشاء حسابك في منصة رفيق AI بنجاح.

بيانات الدخول:
📧 البريد: {{email}}
🔑 كلمة المرور المؤقتة: {{temporary_password}}

🔗 رابط الدخول:
{{login_url}}

فريق رفيق يتمنى لك تجربة ناجحة 🚀',
          '00000000-0000-0000-0000-000000000000'::UUID
        ),
        (
          'Welcome New Merchant',
          'NEW_MERCHANT_REGISTERED',
          'whatsapp',
          'en',
          'Hello {{merchant_name}} 👋

Your account on Rafeq AI platform has been created successfully.

Login Details:
📧 Email: {{email}}
🔑 Temp Password: {{temporary_password}}

🔗 Login URL:
{{login_url}}

Rafeq Team wishes you a successful experience 🚀',
          '00000000-0000-0000-0000-000000000000'::UUID
        ),
        (
          'اشتراك على وشك الانتهاء',
          'SUBSCRIPTION_EXPIRING',
          'whatsapp',
          'ar',
          'مرحبًا {{merchant_name}} 👋

اشتراكك في خطة {{plan_name}} سينتهي في {{expiry_date}}.

لتجنب انقطاع الخدمة، يرجى تجديد اشتراكك:
{{login_url}}

فريق رفيق AI 💙',
          '00000000-0000-0000-0000-000000000000'::UUID
        ),
        (
          'تم إيقاف الحساب',
          'ACCOUNT_SUSPENDED',
          'whatsapp',
          'ar',
          'مرحبًا {{merchant_name}} 👋

تم إيقاف حسابك في منصة رفيق AI.

للاستفسار أو الاعتراض، يرجى التواصل مع الدعم الفني.

فريق رفيق AI',
          '00000000-0000-0000-0000-000000000000'::UUID
        ),
        (
          'تم استلام الدفعة',
          'PAYMENT_RECEIVED',
          'whatsapp',
          'ar',
          'مرحبًا {{merchant_name}} 👋

تم استلام دفعتك بنجاح ✅

المبلغ: {{payment_amount}}
الخطة: {{plan_name}}

شكراً لك، فريق رفيق AI 💙',
          '00000000-0000-0000-0000-000000000000'::UUID
        )
      ) AS v(name, trigger_event, channel, language, content, created_by)
      WHERE NOT EXISTS (
        SELECT 1 FROM admin_notification_templates LIMIT 1
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS admin_notification_templates;
    `);
  }
}
