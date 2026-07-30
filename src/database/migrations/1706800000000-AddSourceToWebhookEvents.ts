import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔒 FIX F-15: نقل migration شارد كان في src/src/migrations (لا يُحمَّل أبداً)
 * ───────────────────────────────────────────────────────────────────────────────
 * الكيان webhook-event يعرّف عمود "source" ويفهرسه، لكن الـ migration الذي يُنشئه
 * كان في المجلد الخطأ (src/src/migrations) فلم يُطبَّق في الإنتاج (synchronize=false).
 * نقلناه إلى المجلد الرسمي (src/database/migrations) وجعلناه idempotent:
 *   • يفحص وجود العمود أولاً — فلا يفشل لو أُنشئ سابقاً (بيئات synchronize).
 *   • يملأ الصفوف القديمة بـ 'system' قبل فرض NOT NULL (لا يكسر بيانات قائمة).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export class AddSourceToWebhookEvents1706800000000 implements MigrationInterface {
  name = 'AddSourceToWebhookEvents1706800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('webhook_events');
    if (!table) {
      // الجدول غير موجود بعد — migration إنشائه سيتكفّل بالعمود عبر الكيان/DDL
      return;
    }
    const hasSource = table.columns.some((c) => c.name === 'source');
    if (hasSource) {
      // العمود موجود مسبقاً (synchronize أو تشغيل سابق) — لا شيء نفعله
      return;
    }

    // 1) أضف العمود بقيمة افتراضية مؤقتة لتفادي مشكلة NULL على الصفوف القائمة
    await queryRunner.query(
      `ALTER TABLE "webhook_events" ADD COLUMN "source" varchar(50) NOT NULL DEFAULT 'system'`,
    );
    // 2) أزل الافتراضي فيصبح إلزامياً صريحاً (يطابق تعريف الكيان: بلا default)
    await queryRunner.query(
      `ALTER TABLE "webhook_events" ALTER COLUMN "source" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('webhook_events');
    if (table && table.columns.some((c) => c.name === 'source')) {
      await queryRunner.query(`ALTER TABLE "webhook_events" DROP COLUMN "source"`);
    }
  }
}
