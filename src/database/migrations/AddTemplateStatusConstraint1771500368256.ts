/**
 * Migration: إضافة قيد (constraint) لحقل status في message_templates
 * 
 * يُضيف:
 * CHECK constraint للتأكد من أن status يحتوي فقط على القيم الصحيحة
 * القيم المسموحة: draft, pending, approved, rejected, active, disabled
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateStatusConstraint1771500368256 implements MigrationInterface {
  name = 'AddTemplateStatusConstraint1771500368256';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE message_templates
      ADD CONSTRAINT chk_template_status
      CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'active', 'disabled'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE message_templates
      DROP CONSTRAINT IF EXISTS chk_template_status
    `);
  }
}
