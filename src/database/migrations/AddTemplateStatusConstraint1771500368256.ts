/**
 * Migration: FIXED — AddTemplateStatusConstraint
 *
 * النسخة الأصلية كانت تحاول إضافة CHECK constraint على عمود
 * 'status' الذي لا يوجد في جدول message_templates.
 *
 * جدول message_templates يستخدم:
 *   - is_active BOOLEAN  (للتفعيل/التعطيل)
 *   - trigger_event ENUM (نوع الحدث)
 * لا يوجد عمود 'status' — هذا المايغريشن كان خاطئاً.
 *
 * الحل: no-op آمن بـ underscore prefix لتجنب TS6133 (noUnusedParameters=true)
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateStatusConstraint1771500368256 implements MigrationInterface {
  name = 'AddTemplateStatusConstraint1771500368256';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op: عمود 'status' غير موجود في message_templates
    // الجدول يستخدم is_active BOOLEAN بدلاً منه
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: لا يوجد constraint لإزالته
  }
}
