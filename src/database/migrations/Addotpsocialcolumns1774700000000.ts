import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ إضافة أعمدة روابط السوشيال ميديا لجدول otp_configs
 *
 * الأعمدة: support_whatsapp, support_discord, support_instagram, support_tiktok, support_twitter
 */
export class AddOtpSocialColumns1774700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "otp_configs"
        ADD COLUMN IF NOT EXISTS "support_whatsapp"  VARCHAR(20)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "support_discord"   VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "support_instagram"  VARCHAR(100) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "support_tiktok"     VARCHAR(100) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "support_twitter"    VARCHAR(100) DEFAULT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "otp_configs"
        DROP COLUMN IF EXISTS "support_whatsapp",
        DROP COLUMN IF EXISTS "support_discord",
        DROP COLUMN IF EXISTS "support_instagram",
        DROP COLUMN IF EXISTS "support_tiktok",
        DROP COLUMN IF EXISTS "support_twitter";
    `);
  }
}
