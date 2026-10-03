import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformBackups1791000000000 implements MigrationInterface {
  name = 'CreatePlatformBackups1791000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE platform_backup_status AS ENUM ('pending', 'running', 'completed', 'failed', 'expired');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      DO $$ BEGIN
        CREATE TYPE platform_backup_trigger AS ENUM ('scheduled', 'manual');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS platform_backups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status platform_backup_status NOT NULL,
        trigger platform_backup_trigger NOT NULL,
        object_key VARCHAR(500),
        size_bytes BIGINT,
        sha256 CHAR(64),
        encryption_key_id CHAR(16),
        database_name VARCHAR(128) NOT NULL,
        requested_by UUID,
        started_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        error_message VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_platform_backups_created ON platform_backups (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_platform_backups_status ON platform_backups (status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_backups_single_active
        ON platform_backups ((1)) WHERE status IN ('pending', 'running');
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS platform_backups`);
    await queryRunner.query(`DROP TYPE IF EXISTS platform_backup_trigger`);
    await queryRunner.query(`DROP TYPE IF EXISTS platform_backup_status`);
  }
}
