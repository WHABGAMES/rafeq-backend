/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: إضافة حقول Multi-Auth لجدول المستخدمين                             ║
 * ║                                                                                ║
 * ║  الحقول الجديدة:                                                               ║
 * ║  - auth_provider: طريقة المصادقة (local, google, salla, zid, otp)             ║
 * ║  - provider_id: معرّف المستخدم عند المزود الخارجي                              ║
 * ║  - provider_avatar: صورة المستخدم من المزود الخارجي                            ║
 * ║  - تعديل password ليكون nullable                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthProviderToUsers1706000000000 implements MigrationInterface {
  name = 'AddAuthProviderToUsers1706000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. إنشاء enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "auth_provider_enum" AS ENUM ('local', 'google', 'salla', 'zid', 'otp');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // 2. إضافة عمود auth_provider
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN IF NOT EXISTS "auth_provider" "auth_provider_enum" NOT NULL DEFAULT 'local'
    `);

    // 3. إضافة عمود provider_id
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN IF NOT EXISTS "provider_id" varchar(255) NULL
    `);

    // 4. إضافة عمود provider_avatar
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN IF NOT EXISTS "provider_avatar" varchar(500) NULL
    `);

    // 5. تعديل password ليكون nullable (لمستخدمي OAuth/OTP)
    await queryRunner.query(`
      ALTER TABLE "users" 
      ALTER COLUMN "password" DROP NOT NULL
    `);

    // 6. إنشاء indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_auth_provider" ON "users" ("auth_provider")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_provider_id" ON "users" ("provider_id")
    `);

    // 7. تعيين auth_provider = 'local' للمستخدمين الموجودين
    await queryRunner.query(`
      UPDATE "users" SET "auth_provider" = 'local' WHERE "auth_provider" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_provider_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_auth_provider"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "provider_avatar"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "provider_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "auth_provider"`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`);
    await queryRunner.query(`DROP TYPE IF EXISTS "auth_provider_enum"`);
  }
}
