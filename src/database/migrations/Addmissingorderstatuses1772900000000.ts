import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ إضافة حالات مفقودة لـ orders_status_enum
 *
 * PostgreSQL BUG FIX:
 * ALTER TYPE ... ADD VALUE لا يعمل داخل transaction
 * transaction: false يحل المشكلة
 */
export class AddMissingOrderStatuses1772900000000 implements MigrationInterface {
  name = 'AddMissingOrderStatuses1772900000000';

  // ✅ تعطيل الـ transaction لأن ALTER TYPE ADD VALUE لا يعمل داخل transaction
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."orders_status_enum"
      ADD VALUE IF NOT EXISTS 'under_review';
    `);

    await queryRunner.query(`
      ALTER TYPE "public"."orders_status_enum"
      ADD VALUE IF NOT EXISTS 'restoring';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL لا يدعم حذف قيمة من enum بدون إعادة بناء كاملة
  }
}
