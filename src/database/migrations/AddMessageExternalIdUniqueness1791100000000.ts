import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * يجعل معرّف رسالة المنصة الخارجية مفتاح idempotency فعلياً.
 * نحذف النسخ المكررة القديمة فقط؛ فهي تمثل إعادة تسليم webhook نفسه.
 */
export class AddMessageExternalIdUniqueness1791100000000 implements MigrationInterface {
  name = 'AddMessageExternalIdUniqueness1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM messages
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY external_id
                   ORDER BY created_at ASC, id ASC
                 ) AS duplicate_number
          FROM messages
          WHERE external_id IS NOT NULL
        ) duplicates
        WHERE duplicate_number > 1
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_messages_external_id"
      ON messages (external_id)
      WHERE external_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_messages_external_id"');
  }
}
