import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminPanelTables1708300000000 implements MigrationInterface {
  name = 'CreateAdminPanelTables1708300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── admin_users ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE admin_role_enum AS ENUM ('owner', 'admin', 'support');
      CREATE TYPE admin_status_enum AS ENUM ('active', 'suspended', 'deleted');

      CREATE TABLE admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role admin_role_enum NOT NULL DEFAULT 'support',
        status admin_status_enum NOT NULL DEFAULT 'active',
        two_fa_secret VARCHAR(255),
        two_fa_enabled BOOLEAN NOT NULL DEFAULT false,
        refresh_token VARCHAR(500),
        last_login_at TIMESTAMPTZ,
        last_login_ip VARCHAR(45),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_admin_email ON admin_users (email);
      CREATE INDEX idx_admin_role ON admin_users (role);
    `);

    // ─── audit_logs (append-only) ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id UUID NOT NULL,
        actor_email VARCHAR(255) NOT NULL,
        actor_role VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(100),
        target_id VARCHAR(255),
        metadata JSONB NOT NULL DEFAULT '{}',
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_audit_actor ON audit_logs (actor_id);
      CREATE INDEX idx_audit_action ON audit_logs (action);
      CREATE INDEX idx_audit_target ON audit_logs (target_type, target_id);
      CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);

      -- Revoke UPDATE/DELETE on audit_logs (immutable)
      CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
      CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
    `);

    // ─── merge_history ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE merge_status_enum AS ENUM ('pending', 'completed', 'rolled_back', 'failed');

      CREATE TABLE merge_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_user_id UUID NOT NULL,
        source_email VARCHAR(255) NOT NULL,
        target_user_id UUID NOT NULL,
        target_email VARCHAR(255) NOT NULL,
        performed_by UUID NOT NULL,
        performed_by_email VARCHAR(255) NOT NULL,
        status merge_status_enum NOT NULL DEFAULT 'pending',
        stores_transferred INT NOT NULL DEFAULT 0,
        transferred_store_ids JSONB NOT NULL DEFAULT '[]',
        metadata JSONB NOT NULL DEFAULT '{}',
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_merge_source ON merge_history (source_user_id);
      CREATE INDEX idx_merge_target ON merge_history (target_user_id);
    `);

    // ─── whatsapp_settings ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE whatsapp_provider_enum AS ENUM ('meta', 'twilio', 'custom');

      CREATE TABLE whatsapp_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone_number VARCHAR(30) NOT NULL,
        provider whatsapp_provider_enum NOT NULL DEFAULT 'meta',
        access_token_encrypted TEXT NOT NULL,
        business_account_id VARCHAR(100),
        phone_number_id VARCHAR(100),
        webhook_url VARCHAR(500),
        webhook_verify_token VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT false,
        last_test_sent_at TIMESTAMPTZ,
        connection_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ─── message_templates ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE trigger_event_enum AS ENUM (
        'NEW_MERCHANT_REGISTERED', 'SUBSCRIPTION_EXPIRING', 'SUBSCRIPTION_EXPIRED',
        'PAYMENT_RECEIVED', 'ACCOUNT_SUSPENDED', 'WELCOME_MESSAGE', 'CUSTOM_MANUAL_SEND'
      );
      CREATE TYPE message_channel_enum AS ENUM ('whatsapp', 'email', 'both');
      CREATE TYPE message_language_enum AS ENUM ('ar', 'en');

      CREATE TABLE message_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        trigger_event trigger_event_enum NOT NULL,
        channel message_channel_enum NOT NULL DEFAULT 'whatsapp',
        language message_language_enum NOT NULL DEFAULT 'ar',
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

      CREATE INDEX idx_template_active ON message_templates (trigger_event, channel, language, is_active);
    `);

    // ─── message_logs ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE message_status_enum AS ENUM ('sent', 'failed', 'pending', 'retrying');

      CREATE TABLE message_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_user_id UUID,
        recipient_phone VARCHAR(30),
        recipient_email VARCHAR(255),
        channel VARCHAR(50) NOT NULL,
        template_id UUID,
        trigger_event VARCHAR(100),
        content TEXT,
        status message_status_enum NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        response_payload JSONB,
        error_message TEXT,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_msglog_recipient ON message_logs (recipient_user_id);
      CREATE INDEX idx_msglog_status ON message_logs (status, created_at DESC);
    `);

    // ─── Seed default templates ───────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO message_templates (name, trigger_event, channel, language, content, created_by) 
      VALUES 
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
        '00000000-0000-0000-0000-000000000000'
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
        '00000000-0000-0000-0000-000000000000'
      ),
      (
        'اشتراك على وشك الانتهاء',
        'SUBSCRIPTION_EXPIRING',
        'whatsapp',
        'ar',
        'مرحبًا {{merchant_name}} 👋

اشتراكك في خطة {{plan_name}} سينتهي في {{expiry_date}}.

لتجنب انقطاع الخدمة، يرجى تجديد اشتراكك من خلال:
{{login_url}}

فريق رفيق AI 💙',
        '00000000-0000-0000-0000-000000000000'
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
        '00000000-0000-0000-0000-000000000000'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS message_logs;
      DROP TABLE IF EXISTS message_templates;
      DROP TABLE IF EXISTS whatsapp_settings;
      DROP TABLE IF EXISTS merge_history;
      DROP TABLE IF EXISTS audit_logs;
      DROP TABLE IF EXISTS admin_users;
      DROP TYPE IF EXISTS message_status_enum;
      DROP TYPE IF EXISTS message_language_enum;
      DROP TYPE IF EXISTS message_channel_enum;
      DROP TYPE IF EXISTS trigger_event_enum;
      DROP TYPE IF EXISTS whatsapp_provider_enum;
      DROP TYPE IF EXISTS merge_status_enum;
      DROP TYPE IF EXISTS admin_status_enum;
      DROP TYPE IF EXISTS admin_role_enum;
    `);
  }
}
