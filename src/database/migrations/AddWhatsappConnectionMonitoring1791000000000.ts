import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappConnectionMonitoring1791000000000 implements MigrationInterface {
  name = 'AddWhatsappConnectionMonitoring1791000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE whatsapp_settings
        ADD COLUMN IF NOT EXISTS last_configured_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_health_checked_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_connection_error text,
        ADD COLUMN IF NOT EXISTS consecutive_health_failures integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_disconnect_alert_at timestamptz
    `);
    await queryRunner.query(`
      UPDATE whatsapp_settings
      SET last_configured_at = COALESCE(last_configured_at, updated_at, created_at, NOW())
      WHERE last_configured_at IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE whatsapp_settings
        DROP COLUMN IF EXISTS last_disconnect_alert_at,
        DROP COLUMN IF EXISTS consecutive_health_failures,
        DROP COLUMN IF EXISTS last_connection_error,
        DROP COLUMN IF EXISTS last_health_checked_at,
        DROP COLUMN IF EXISTS last_configured_at
    `);
  }
}
