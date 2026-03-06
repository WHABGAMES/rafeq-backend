import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ تفعيل القوالب المعلّقة في حالة draft
 *
 * المشكلة: القوالب التي أنشأها التجار كانت تُحفَظ بـ status='draft' افتراضياً
 * النتيجة: dispatch يبحث عن 'approved'/'active' ولا يجد شيئاً → لا إرسال
 *
 * الحل: كل قالب له triggerEvent ومحذوف وليس disabled/rejected → status='active'
 */
export class ActivateDraftTemplates1773000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // تفعيل كل القوالب التي:
    // 1. لها triggerEvent (مرتبطة بحدث)
    // 2. حالتها draft (لم تُفعَّل)
    // 3. غير محذوفة (deleted_at IS NULL)
    await queryRunner.query(`
      UPDATE message_templates
      SET status = 'active', updated_at = NOW()
      WHERE status = 'draft'
        AND trigger_event IS NOT NULL
        AND trigger_event != ''
        AND deleted_at IS NULL
    `);

    // تغيير default القيمة في الـ column
    await queryRunner.query(`
      ALTER TABLE message_templates
      ALTER COLUMN status SET DEFAULT 'active'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE message_templates
      ALTER COLUMN status SET DEFAULT 'draft'
    `);
  }
}
