import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ إضافة حالات مفقودة لـ orders_status_enum
 *
 * under_review — بانتظار المراجعة (كانت تُحفَظ كـ 'processing' خطأً)
 * restoring    — قيد الاسترجاع   (كانت تُحفَظ كـ 'processing' خطأً)
 *
 * PostgreSQL: ALTER TYPE ... ADD VALUE لا يتطلب إعادة بناء الجدول
 */
export class AddMissingOrderStatuses1772900000000 implements MigrationInterface {
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
    // الـ down لا تُنفَّذ في production
  }
}
