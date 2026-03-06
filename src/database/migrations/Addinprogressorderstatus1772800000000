import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ v22 Migration: إضافة 'in_progress' إلى OrderStatus enum
 *
 * المشكلة:
 * سلة ترسل slug='in_progress' لحالة "قيد التنفيذ"
 * كان يُحفَظ في DB كـ 'processing' → يرسل نفس قالب "تم التنفيذ"
 *
 * الحل:
 * إضافة 'in_progress' كقيمة مستقلة في PostgreSQL enum
 * حتى يُحفَظ كل طلب بحالته الصحيحة ويُرسَل القالب المناسب
 */
export class AddInProgressOrderStatus1772800000000 implements MigrationInterface {
  name = 'AddInProgressOrderStatus1772800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── إضافة القيمة الجديدة إلى enum في PostgreSQL ──────────────────────────
    // PostgreSQL لا يسمح بـ DROP/RECREATE enum إذا يستخدمه column
    // ALTER TYPE ... ADD VALUE هو الطريقة الصحيحة
    await queryRunner.query(`
      ALTER TYPE "public"."orders_status_enum" 
      ADD VALUE IF NOT EXISTS 'in_progress';
    `);

    // ─── تحديث السجلات القديمة: 'processing' من مصدر سلة → 'in_progress' ──────
    // ملاحظة: نتحقق أولاً من metadata لمعرفة المصدر الأصلي
    // الطلبات القديمة بدون metadata تبقى 'processing' (لا تأثير على القوالب)
    await queryRunner.query(`
      UPDATE orders
      SET status = 'in_progress'
      WHERE status = 'processing'
        AND (
          metadata->>'originalSlug' = 'in_progress'
          OR metadata->>'sallaSlug' = 'in_progress'
          OR metadata->>'statusSlug' = 'in_progress'
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback: إعادة 'in_progress' → 'processing'
    // ملاحظة: PostgreSQL لا يدعم DROP VALUE من enum
    // الحل: نُحدّث السجلات فقط
    await queryRunner.query(`
      UPDATE orders
      SET status = 'processing'
      WHERE status = 'in_progress';
    `);
  }
}
