/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           Migration: إضافة أعمدة إحصائيات سلة المخزّنة محلياً                 ║
 * ║                                                                                ║
 * ║  المشكلة المُحلولة:                                                            ║
 * ║    كل GET /api/stores كان يُطلق 3 طلبات لـ Salla API لكل متجر نشط             ║
 * ║    → عند انتهاء التوكن: 3x 401 errors في السجل لكل مستخدم يفتح الداشبورد      ║
 * ║    → في الإنتاج مع آلاف المتاجر = عشرات الآلاف من الطلبات الزائدة             ║
 * ║                                                                                ║
 * ║  الحل:                                                                         ║
 * ║    نفس نمط Zid: حفظ الإحصائيات محلياً في DB                                   ║
 * ║    تُحدَّث فقط عند: ربط المتجر / POST /stores/:id/sync                         ║
 * ║    لا API calls عند كل تحميل للداشبورد                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSallaStatsColumns1771700000000 implements MigrationInterface {
  name = 'AddSallaStatsColumns1771700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ✅ IF NOT EXISTS — آمن للتطبيق مرتين (idempotent)
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "salla_orders_count"   integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "salla_products_count"  integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "salla_customers_count" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "salla_last_sync_at"    timestamptz
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "stores"."salla_orders_count"   IS 'عدد الطلبات في سلة (مخزّن محلياً — يُحدَّث عند المزامنة)';
      COMMENT ON COLUMN "stores"."salla_products_count"  IS 'عدد المنتجات في سلة (مخزّن محلياً — يُحدَّث عند المزامنة)';
      COMMENT ON COLUMN "stores"."salla_customers_count" IS 'عدد العملاء في سلة (مخزّن محلياً — يُحدَّث عند المزامنة)';
      COMMENT ON COLUMN "stores"."salla_last_sync_at"    IS 'آخر مزامنة لإحصائيات سلة';
    `);

    // ✅ تهيئة القيم للمتاجر الموجودة — لا تترك nulls
    await queryRunner.query(`
      UPDATE "stores"
      SET
        "salla_orders_count"   = COALESCE("salla_orders_count",   0),
        "salla_products_count"  = COALESCE("salla_products_count",  0),
        "salla_customers_count" = COALESCE("salla_customers_count", 0)
      WHERE "platform" = 'salla'
        AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
      DROP COLUMN IF EXISTS "salla_orders_count",
      DROP COLUMN IF EXISTS "salla_products_count",
      DROP COLUMN IF EXISTS "salla_customers_count",
      DROP COLUMN IF EXISTS "salla_last_sync_at"
    `);
  }
}
