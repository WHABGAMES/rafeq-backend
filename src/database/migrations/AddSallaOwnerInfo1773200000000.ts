import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: Add Salla Owner Personal Info Columns                             ║
 * ║                                                                                ║
 * ║  🐛 BUG FIX: النظام كان يجلب إيميل المتجر (store/info → support@salla.dev)     ║
 * ║     بدلاً من إيميل التاجر الشخصي (user/info → الإيميل الحقيقي)                  ║
 * ║                                                                                ║
 * ║  هذه الأعمدة تحفظ بيانات المالك الشخصية المجلوبة من:                            ║
 * ║  GET https://api.salla.dev/admin/v2/oauth2/user/info                             ║
 * ║                                                                                ║
 * ║  - salla_owner_email: الإيميل الشخصي للتاجر (للحساب وبيانات الدخول)             ║
 * ║  - salla_owner_mobile: رقم الجوال الشخصي (للواتساب وبيانات الدخول)              ║
 * ║  - salla_owner_name: اسم التاجر الشخصي                                         ║
 * ║                                                                                ║
 * ║  ⚠️ الأعمدة الموجودة (salla_email, salla_mobile) تبقى كما هي                  ║
 * ║     لأنها تمثل بيانات المتجر (وليس المالك)                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
export class AddSallaOwnerInfo1773200000000 implements MigrationInterface {
  name = 'AddSallaOwnerInfo1773200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. إضافة الأعمدة الجديدة
    await queryRunner.query(`
      ALTER TABLE "stores"
        ADD COLUMN IF NOT EXISTS "salla_owner_email"  VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "salla_owner_mobile" VARCHAR(20)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "salla_owner_name"   VARCHAR(255) DEFAULT NULL
    `);

    // 2. تحديث التعليقات
    await queryRunner.query(`
      COMMENT ON COLUMN "stores"."salla_owner_email"  IS 'الإيميل الشخصي لمالك المتجر (من OAuth user/info — يُستخدم لإنشاء الحساب)';
      COMMENT ON COLUMN "stores"."salla_owner_mobile" IS 'رقم جوال مالك المتجر الشخصي (من OAuth user/info)';
      COMMENT ON COLUMN "stores"."salla_owner_name"   IS 'اسم مالك المتجر الشخصي (من OAuth user/info)';
    `);

    // 3. تحديث التعليقات على الأعمدة القديمة للتوضيح
    await queryRunner.query(`
      COMMENT ON COLUMN "stores"."salla_email"  IS 'إيميل المتجر من store/info (ليس إيميل المالك الشخصي — قد يكون support@salla.dev)';
      COMMENT ON COLUMN "stores"."salla_mobile" IS 'رقم هاتف المتجر من store/info (ليس رقم المالك الشخصي)';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
        DROP COLUMN IF EXISTS "salla_owner_email",
        DROP COLUMN IF EXISTS "salla_owner_mobile",
        DROP COLUMN IF EXISTS "salla_owner_name"
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "stores"."salla_email"  IS 'البريد في سلة';
      COMMENT ON COLUMN "stores"."salla_mobile" IS 'رقم الهاتف في سلة';
    `);
  }
}
