import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔒 FIX F-08 + F-22: توحيد إنشاء مخطط الجداول الإدارية في migration
 * ───────────────────────────────────────────────────────────────────────────────
 * المشكلة: أربعة جداول إدارية كانت تُنشأ فقط داخل onModuleInit للخدمات
 * (اقتران المخطط بدورة حياة الخدمة — F-22)، ولا يملكها أي migration (F-08).
 * فالنشر المعتمد على migrations فقط (synchronize=false) قد لا يملك هذه الجداول
 * قبل إقلاع الخدمات، أو يعتمد على ترتيب إقلاع هشّ.
 *
 * الحل: هذا الـ migration ينشئ الجداول الأربعة بشكل idempotent (نفس DDL الذي
 * تنتجه الخدمات، IF NOT EXISTS)، فيصبح المخطط مملوكاً للـ migrations (مصدر واحد).
 * أُبقي على DDL الخدمات كما هو (idempotent) لعدم كسر النشرات القائمة — فهذا
 * الـ migration متناغم معها لا متعارض: أيّهما سبق، الآخر يتخطّى بأمان.
 *
 * الجداول: audit_logs · admin_notification_templates · admin_alert_recipients · message_logs
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export class ConsolidateAdminSchema1775600000000 implements MigrationInterface {
  name = 'ConsolidateAdminSchema1775600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1) audit_logs (+ أعمدة إضافية + فهارس + قواعد عدم القابلية للتعديل) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id      UUID         NOT NULL,
        actor_email   VARCHAR(255) NOT NULL,
        actor_role    VARCHAR(50)  NOT NULL,
        action        VARCHAR(100) NOT NULL,
        target_type   VARCHAR(100),
        target_id     VARCHAR(255),
        metadata      JSONB        NOT NULL DEFAULT '{}',
        ip_address    VARCHAR(45),
        user_agent    TEXT,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        tenant_id     UUID,
        tenant_name   VARCHAR(255),
        store_name    VARCHAR(255)
      );
    `);
    await queryRunner.query(`
      ALTER TABLE audit_logs
        ADD COLUMN IF NOT EXISTS tenant_id   UUID,
        ADD COLUMN IF NOT EXISTS tenant_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS store_name  VARCHAR(255);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs (actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs (action);
      CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_logs (target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_tenant  ON audit_logs (tenant_id);
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_rules WHERE tablename = 'audit_logs' AND rulename = 'no_update_audit') THEN
          CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_rules WHERE tablename = 'audit_logs' AND rulename = 'no_delete_audit') THEN
          CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
        END IF;
      END $$;
    `);

    // ── 2) admin_notification_templates (+ أعمدة إضافية + فهارس) ──
    await queryRunner.query(`
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
      );
    `);
    await queryRunner.query(`
      ALTER TABLE admin_notification_templates
        ADD COLUMN IF NOT EXISTS sent_count   INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_notif_event_channel_lang
        ON admin_notification_templates (trigger_event, channel, language, is_active);
      CREATE INDEX IF NOT EXISTS idx_admin_notif_active     ON admin_notification_templates (is_active);
      CREATE INDEX IF NOT EXISTS idx_admin_notif_deleted_at ON admin_notification_templates (deleted_at);
    `);

    // ── 3) admin_alert_recipients (+ فهرس) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS admin_alert_recipients (
        id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        name              VARCHAR(100) NOT NULL,
        phone             VARCHAR(20)  NOT NULL UNIQUE,
        subscribed_events JSONB        NOT NULL DEFAULT '[]',
        is_active         BOOLEAN      NOT NULL DEFAULT true,
        note              VARCHAR(500),
        sent_count        INT          NOT NULL DEFAULT 0,
        last_sent_at      TIMESTAMPTZ,
        created_by        UUID         NOT NULL,
        updated_by        UUID,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_alert_recipient_active ON admin_alert_recipients (is_active);
    `);

    // ── 4) message_logs (+ أعمدة إضافية + فهارس) ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        channel    VARCHAR(50) NOT NULL,
        status     VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts   INT         NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      ALTER TABLE message_logs
        ADD COLUMN IF NOT EXISTS recipient_user_id UUID,
        ADD COLUMN IF NOT EXISTS recipient_phone   VARCHAR(30),
        ADD COLUMN IF NOT EXISTS recipient_email   VARCHAR(255),
        ADD COLUMN IF NOT EXISTS template_id       UUID,
        ADD COLUMN IF NOT EXISTS trigger_event     VARCHAR(100),
        ADD COLUMN IF NOT EXISTS content           TEXT,
        ADD COLUMN IF NOT EXISTS response_payload  JSONB,
        ADD COLUMN IF NOT EXISTS error_message     TEXT,
        ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS direction         VARCHAR(10) NOT NULL DEFAULT 'outbound';
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_msglog_recipient ON message_logs (recipient_user_id);
      CREATE INDEX IF NOT EXISTS idx_msglog_phone     ON message_logs (recipient_phone);
      CREATE INDEX IF NOT EXISTS idx_msglog_status    ON message_logs (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_msglog_channel   ON message_logs (channel, created_at DESC);
    `);
  }

  public async down(): Promise<void> {
    // لا نُسقط هذه الجداول في التراجع: قد تحوي بيانات تدقيق/سجلّات حيّة، وإسقاطها
    // يُفقد بيانات لا رجعة فيها. التراجع مقصود أن يكون no-op آمناً.
  }
}
