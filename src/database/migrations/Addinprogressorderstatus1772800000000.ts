import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ v22 Migration: إضافة 'in_progress' إلى OrderStatus enum
 *
 * PostgreSQL BUG FIX:
 * ALTER TYPE ... ADD VALUE لا يصبح مرئياً داخل نفس الـ transaction
 * الحل: transaction: false — يشغّل الـ migration خارج transaction
 * فيصبح ADD VALUE مرئياً فوراً للـ UPDATE في نفس الـ migration
 */
export class AddInProgressOrderStatus1772800000000 implements MigrationInterface {
  name = 'AddInProgressOrderStatus1772800000000';

  // ✅ تعطيل الـ transaction لأن ALTER TYPE ADD VALUE لا يعمل داخل transaction
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── إضافة القيمة الجديدة إلى enum ───────────────────────────────────────
    await queryRunner.query(`
      ALTER TYPE "public"."orders_status_enum"
      ADD VALUE IF NOT EXISTS 'in_progress';
    `);

    // ─── تحديث السجلات القديمة ────────────────────────────────────────────────
    await queryRunner.query(`
      UPDATE orders
      SET status = 'in_progress'::orders_status_enum
      WHERE status = 'processing'
        AND (
          metadata->>'originalSlug' = 'in_progress'
          OR metadata->>'sallaSlug' = 'in_progress'
          OR metadata->>'statusSlug' = 'in_progress'
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE orders
      SET status = 'processing'
      WHERE status = 'in_progress';
    `);
  }
}
