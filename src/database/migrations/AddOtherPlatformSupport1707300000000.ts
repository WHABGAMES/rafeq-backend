/**
 * Migration: إضافة دعم المتاجر الأخرى (Other Platforms)
 * 
 * يُضيف:
 * 1. قيمة 'other' للـ store_platform enum
 * 2. حقول جنريك للمتاجر الخارجية
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtherPlatformSupport1707300000000 implements MigrationInterface {
  name = 'AddOtherPlatformSupport1707300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. إضافة 'other' للـ enum
    await queryRunner.query(`
      ALTER TYPE "public"."stores_platform_enum" 
      ADD VALUE IF NOT EXISTS 'other'
    `);

    // 2. إضافة حقول المتاجر الأخرى
    await queryRunner.query(`
      ALTER TABLE "stores" 
      ADD COLUMN IF NOT EXISTS "other_platform_name" varchar(100),
      ADD COLUMN IF NOT EXISTS "other_api_base_url" varchar(500),
      ADD COLUMN IF NOT EXISTS "other_store_url" varchar(500),
      ADD COLUMN IF NOT EXISTS "other_store_id" varchar(255)
    `);

    // 3. تعليقات
    await queryRunner.query(`
      COMMENT ON COLUMN "stores"."other_platform_name" IS 'اسم المنصة (مثل: Shopify, WooCommerce, OpenCart...)';
      COMMENT ON COLUMN "stores"."other_api_base_url" IS 'رابط API الأساسي للمنصة';
      COMMENT ON COLUMN "stores"."other_store_url" IS 'رابط المتجر الخارجي';
      COMMENT ON COLUMN "stores"."other_store_id" IS 'معرّف المتجر في المنصة الخارجية';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores" 
      DROP COLUMN IF EXISTS "other_platform_name",
      DROP COLUMN IF EXISTS "other_api_base_url",
      DROP COLUMN IF EXISTS "other_store_url",
      DROP COLUMN IF EXISTS "other_store_id"
    `);

    // ملاحظة: PostgreSQL لا يدعم حذف قيمة من enum بسهولة
    // لذلك نتركها كما هي
  }
}
