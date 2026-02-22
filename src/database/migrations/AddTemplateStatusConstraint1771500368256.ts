/**
 * Migration: FIXED — AddTemplateStatusConstraint
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  BUG: النسخة الأصلية حاولت إضافة CHECK constraint على عمود     ║
 * ║       'status' الذي لا يوجد في جدول message_templates           ║
 * ║  ERROR: column "status" does not exist                          ║
 * ║  FIX: تحويل المايغريشن إلى no-op آمن                           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * جدول message_templates يستخدم:
 *   - is_active BOOLEAN  (للتفعيل/التعطيل)
 *   - trigger_event ENUM (نوع الحدث)
 * لا يوجد عمود 'status' في هذا الجدول
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateStatusConstraint1771500368256 implements MigrationInterface {
  name = 'AddTemplateStatusConstraint1771500368256';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // FIXED: no-op — العمود 'status' غير موجود في message_templates
    // الجدول يستخدم is_active BOOLEAN بدلاً من status
    // لا نضيف أي constraint لتجنب: column "status" does not exist
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FIXED: no-op — لا يوجد شيء لإزالته
  }
}
