import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ إنشاء جدول platform_notification_user_actions
 *
 * يحل مشكلتين:
 * 1. الإغلاق ما يحفظ — التاجر يغلق الإشعار لكن يرجع يطلع
 * 2. المشاهدات تتكرر — نفس التاجر يُحسب عدة مرات
 *
 * الحل: جدول يحفظ (إشعار + مستخدم + إجراء) مع unique constraint
 */
export class CreatePlatformNotificationUserActions1774200000000 implements MigrationInterface {
  name = 'CreatePlatformNotificationUserActions1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_notification_user_actions (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_id  UUID        NOT NULL,
        user_id          UUID        NOT NULL,
        action           VARCHAR(20) NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_notif_user_action
          UNIQUE (notification_id, user_id, action)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pnua_user
      ON platform_notification_user_actions (user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pnua_notification
      ON platform_notification_user_actions (notification_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_notification_user_actions;`);
  }
}
