/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: إضافة type + answer لجدول knowledge_base                          ║
 * ║                                                                                ║
 * ║  BUG-KB1 FIX: الواجهة ترسل type='article'|'qna' و answer                     ║
 * ║  لكن الجدول لا يحتوي هذه الأعمدة — نضيفها الآن                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddKnowledgeTypeAndAnswer1739300000000 implements MigrationInterface {
  name = 'AddKnowledgeTypeAndAnswer1739300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. إضافة عمود type ──
    const hasType = await queryRunner.hasColumn('knowledge_base', 'type');
    if (!hasType) {
      await queryRunner.addColumn(
        'knowledge_base',
        new TableColumn({
          name: 'type',
          type: 'varchar',
          length: '20',
          default: "'article'",
          isNullable: false,
          comment: 'article or qna',
        }),
      );
    }

    // ── 2. إضافة عمود answer ──
    const hasAnswer = await queryRunner.hasColumn('knowledge_base', 'answer');
    if (!hasAnswer) {
      await queryRunner.addColumn(
        'knowledge_base',
        new TableColumn({
          name: 'answer',
          type: 'text',
          isNullable: true,
          comment: 'Answer text for QnA type entries',
        }),
      );
    }

    // ── 3. إضافة index على type ──
    await queryRunner.createIndex(
      'knowledge_base',
      new TableIndex({
        name: 'IDX_knowledge_base_tenant_type',
        columnNames: ['tenant_id', 'type'],
      }),
    ).catch(() => { /* index already exists */ });

    // ── 4. تحديث السجلات الموجودة ──
    await queryRunner.query(
      `UPDATE knowledge_base SET "type" = 'article' WHERE "type" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_knowledge_base_tenant_type"`,
    );

    const hasAnswer = await queryRunner.hasColumn('knowledge_base', 'answer');
    if (hasAnswer) {
      await queryRunner.dropColumn('knowledge_base', 'answer');
    }

    const hasType = await queryRunner.hasColumn('knowledge_base', 'type');
    if (hasType) {
      await queryRunner.dropColumn('knowledge_base', 'type');
    }
  }
}
