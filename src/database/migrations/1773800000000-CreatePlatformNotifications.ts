import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: إنشاء جدول platform_notifications
 * نظام الإشعارات الإدارية للتجار
 */
export class CreatePlatformNotifications1773800000000 implements MigrationInterface {
  name = 'CreatePlatformNotifications1773800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE platform_notification_type AS ENUM ('alert','maintenance','marketing','custom');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE platform_notification_display AS ENUM ('bar','popup','inline');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE platform_notification_color AS ENUM ('blue','green','yellow','red','purple','orange','custom');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // ── Table ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_notifications (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Content
        type             platform_notification_type    NOT NULL DEFAULT 'custom',
        display_type     platform_notification_display NOT NULL DEFAULT 'bar',
        title            VARCHAR(255),
        message          TEXT NOT NULL,
        link             VARCHAR(512),
        link_label       VARCHAR(100),

        -- Design
        color_scheme     platform_notification_color   NOT NULL DEFAULT 'blue',
        bg_color         VARCHAR(50),
        text_color       VARCHAR(50),
        icon             VARCHAR(50),
        is_scrolling     BOOLEAN NOT NULL DEFAULT false,
        is_dismissible   BOOLEAN NOT NULL DEFAULT true,

        -- Targeting
        target_plans     TEXT[]  NOT NULL DEFAULT '{}',
        show_on_pages    TEXT[]  NOT NULL DEFAULT '{}',
        show_on_login    BOOLEAN NOT NULL DEFAULT false,

        -- Timing
        starts_at        TIMESTAMPTZ,
        ends_at          TIMESTAMPTZ,
        repeat_hours     INTEGER,

        -- Stats & State
        priority         INTEGER NOT NULL DEFAULT 0,
        is_active        BOOLEAN NOT NULL DEFAULT true,
        views_count      INTEGER NOT NULL DEFAULT 0,
        dismissals_count INTEGER NOT NULL DEFAULT 0,
        created_by       VARCHAR(100),

        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_notif_active_timing
        ON platform_notifications (is_active, starts_at, ends_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_notif_priority
        ON platform_notifications (priority DESC, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_notifications;`);
    await queryRunner.query(`DROP TYPE IF EXISTS platform_notification_color;`);
    await queryRunner.query(`DROP TYPE IF EXISTS platform_notification_display;`);
    await queryRunner.query(`DROP TYPE IF EXISTS platform_notification_type;`);
  }
}
