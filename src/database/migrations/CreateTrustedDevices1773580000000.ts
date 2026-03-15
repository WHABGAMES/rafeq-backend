/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: CreateTrustedDevices1773580000000                                  ║
 * ║                                                                               ║
 * ║  يُنشئ جدول trusted_devices ويُضيف عمود device_token إذا كان موجوداً مسبقاً  ║
 * ║  آمن للتشغيل في أي وقت — IF NOT EXISTS في كل خطوة                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTrustedDevices1773580000000 implements MigrationInterface {
  name = 'CreateTrustedDevices1773580000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ─── إنشاء الجدول كاملاً إذا لم يكن موجوداً ──────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trusted_devices" (
        "id"             UUID              NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        UUID              NOT NULL,
        "tenant_id"      UUID,
        "device_name"    VARCHAR(100)      NOT NULL,
        "browser"        VARCHAR(50)       NOT NULL,
        "os"             VARCHAR(50)       NOT NULL,
        "ip_address"     VARCHAR(45)       NOT NULL,
        "user_agent"     TEXT,
        "device_token"   VARCHAR(64)       UNIQUE,
        "is_active"      BOOLEAN           NOT NULL DEFAULT true,
        "last_active_at" TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        "created_at"     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_trusted_devices" PRIMARY KEY ("id")
      )
    `);

    // ─── index على user_id ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trusted_devices_user_id"
      ON "trusted_devices" ("user_id")
    `);

    // ─── إضافة device_token إذا كان الجدول موجوداً مسبقاً بدونه ──────────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'trusted_devices'
          AND column_name = 'device_token'
        ) THEN
          ALTER TABLE "trusted_devices"
          ADD COLUMN "device_token" VARCHAR(64) UNIQUE;
        END IF;
      END
      $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "trusted_devices"`);
  }
}
