import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminAlertDeliveryStats1790910000000 implements MigrationInterface {
  name = 'AddAdminAlertDeliveryStats1790910000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_alert_recipients
        ADD COLUMN IF NOT EXISTS queued_count INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS failed_count INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_queued_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_failure_reason VARCHAR(500)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_alert_recipients
        DROP COLUMN IF EXISTS last_failure_reason,
        DROP COLUMN IF EXISTS last_failed_at,
        DROP COLUMN IF EXISTS last_queued_at,
        DROP COLUMN IF EXISTS failed_count,
        DROP COLUMN IF EXISTS queued_count
    `);
  }
}
