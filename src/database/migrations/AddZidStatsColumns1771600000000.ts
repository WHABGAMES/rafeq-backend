/**
 * Migration: إضافة أعمدة إحصائيات زد
 *
 * يُضيف أعمدة لحفظ إحصائيات متجر زد محلياً لتفادي استدعاء API في كل تحميل:
 *   zid_orders_count   — عدد الطلبات
 *   zid_products_count — عدد المنتجات
 *   zid_customers_count — عدد العملاء
 *   zid_last_sync_at   — آخر مزامنة للإحصائيات
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddZidStatsColumns1771600000000 implements MigrationInterface {
  name = 'AddZidStatsColumns1771600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "zid_orders_count"   integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "zid_products_count"  integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "zid_customers_count" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "zid_last_sync_at"    timestamptz
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "stores"."zid_orders_count"   IS 'عدد الطلبات في زد (مخزّن محلياً)';
      COMMENT ON COLUMN "stores"."zid_products_count"  IS 'عدد المنتجات في زد (مخزّن محلياً)';
      COMMENT ON COLUMN "stores"."zid_customers_count" IS 'عدد العملاء في زد (مخزّن محلياً)';
      COMMENT ON COLUMN "stores"."zid_last_sync_at"    IS 'آخر مزامنة لإحصائيات زد';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
      DROP COLUMN IF EXISTS "zid_orders_count",
      DROP COLUMN IF EXISTS "zid_products_count",
      DROP COLUMN IF EXISTS "zid_customers_count",
      DROP COLUMN IF EXISTS "zid_last_sync_at"
    `);
  }
}
