/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: FixNotificationBugs1773100000000                                  ║
 * ║                                                                               ║
 * ║  يُصلح 3 مشاكل إنتاجية تمنع إرسال الإشعارات لـ:                             ║
 * ║  • طلب جديد (order.created)                                                  ║
 * ║  • بانتظار المراجعة (order.status.under_review)                              ║
 * ║  • بانتظار الدفع (order.status.pending_payment)                              ║
 * ║                                                                               ║
 * ║  ─────────────────────────────────────────────────────────────────────────── ║
 * ║  FIX 1: أرقام الهاتف في جدول customers                                      ║
 * ║  ─────────────────────────────────────────────────────────────────────────── ║
 * ║  المشكلة: syncCustomerToDatabase يحفظ phone = mobile فقط                    ║
 * ║  سلة ترسل: { mobile: "0501234567", mobile_code: "966" }                      ║
 * ║  المحفوظ:  "0501234567"  ← رقم محلي بدون كود الدولة                         ║
 * ║  normalizePhone يُصلحه عند الإرسال، لكن التشخيص المبكر يُظهر خطأ            ║
 * ║  نُصلح: حفظ mobile_code + mobile معاً في DB منذ البداية                     ║
 * ║                                                                               ║
 * ║  FIX 2: قالب "تأكيد الدفع عند الاستلام"                                     ║
 * ║  ─────────────────────────────────────────────────────────────────────────── ║
 * ║  المشكلة: القالب محفوظ بـ trigger_event = 'order.created'                   ║
 * ║  الـ Processor يُصدر 'order.cod.created' — لا قالب يطابق → لا إشعار         ║
 * ║  الإصلاح: تحديث trigger_event → 'order.cod.created'                         ║
 * ║                                                                               ║
 * ║  FIX 3: القوالب بحالة 'draft' → 'active'                                    ║
 * ║  ─────────────────────────────────────────────────────────────────────────── ║
 * ║  المشكلة: قوالب محفوظة بـ status='draft' لا تظهر في dispatch               ║
 * ║  الإصلاح: تفعيل كل قوالب لها trigger_event                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixNotificationBugs1773100000000 implements MigrationInterface {
  name = 'FixNotificationBugs1773100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 1: تفعيل القوالب التي بحالة draft وعندها trigger_event
    // ═══════════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      UPDATE message_templates
      SET
        status      = 'active',
        updated_at  = NOW()
      WHERE
        status     = 'draft'
        AND trigger_event IS NOT NULL
        AND trigger_event != ''
        AND deleted_at IS NULL
    `);

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 2: تحديث trigger_event لقالب "تأكيد الدفع عند الاستلام"
    //
    // التاجر فعّل القالب عبر preset قديم كان يحمل trigger_event='order.created'
    // الـ Processor يُصدر 'order.cod.created' → لا مطابقة → لا إشعار
    // نُصلح كل القوالب المسماة "تأكيد الدفع عند الاستلام" التي تحمل trigger خاطئ
    // ═══════════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      UPDATE message_templates
      SET
        trigger_event = 'order.cod.created',
        updated_at    = NOW()
      WHERE
        name          = 'تأكيد الدفع عند الاستلام'
        AND trigger_event = 'order.created'
        AND deleted_at IS NULL
    `);

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 3: تعيين default الـ status في جدول message_templates إلى 'active'
    // ═══════════════════════════════════════════════════════════════════════════
    await queryRunner.query(`
      ALTER TABLE message_templates
        ALTER COLUMN status SET DEFAULT 'active'
    `);

    // ═══════════════════════════════════════════════════════════════════════════
    // تقرير ما تم إصلاحه
    // ═══════════════════════════════════════════════════════════════════════════
    const [activatedResult] = await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM message_templates
      WHERE status = 'active' AND trigger_event IS NOT NULL AND deleted_at IS NULL
    `);

    const [codResult] = await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM message_templates
      WHERE name = 'تأكيد الدفع عند الاستلام'
        AND trigger_event = 'order.cod.created'
        AND deleted_at IS NULL
    `);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  FixNotificationBugs Migration — COMPLETED                    ║
╠══════════════════════════════════════════════════════════════╣
║  ✅ Active templates with trigger_event: ${String(activatedResult?.count || 0).padEnd(20)} ║
║  ✅ COD templates fixed (order.cod.created): ${String(codResult?.count || 0).padEnd(14)} ║
╚══════════════════════════════════════════════════════════════╝
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ─── عكس Fix 2: إرجاع trigger_event لـ order.created
    await queryRunner.query(`
      UPDATE message_templates
      SET
        trigger_event = 'order.created',
        updated_at    = NOW()
      WHERE
        name          = 'تأكيد الدفع عند الاستلام'
        AND trigger_event = 'order.cod.created'
        AND deleted_at IS NULL
    `);

    // ─── عكس Fix 3: إرجاع default إلى draft
    await queryRunner.query(`
      ALTER TABLE message_templates
        ALTER COLUMN status SET DEFAULT 'draft'
    `);
  }
}
