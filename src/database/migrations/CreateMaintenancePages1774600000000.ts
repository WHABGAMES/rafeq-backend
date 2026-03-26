import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ إنشاء جدول maintenance_pages — نظام الصيانة الجزئي
 *
 * يسمح للأدمن بتفعيل وضع الصيانة لصفحات محددة في الداشبورد
 * بدون تعطيل المنصة بالكامل
 */
export class CreateMaintenancePages1774600000000 implements MigrationInterface {
  name = 'CreateMaintenancePages1774600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // إنشاء الجدول
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS maintenance_pages (
        id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
        route         VARCHAR(255)      NOT NULL,
        label         VARCHAR(255)      NOT NULL,
        is_active     BOOLEAN           NOT NULL DEFAULT false,
        style         VARCHAR(20)       NOT NULL DEFAULT 'overlay',
        message       VARCHAR(500),
        activated_by  VARCHAR(255),
        created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW()
      );
    `);

    // فهرس فريد على route
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_pages_route
      ON maintenance_pages(route);
    `);

    // إدخال الصفحات الافتراضية
    await queryRunner.query(`
      INSERT INTO maintenance_pages (route, label, is_active, style) VALUES
        ('/dashboard', 'الرئيسية', false, 'overlay'),
        ('/dashboard/inbox', 'المحادثات', false, 'overlay'),
        ('/dashboard/contacts', 'العملاء', false, 'overlay'),
        ('/dashboard/inbox/settings', 'قاعدة بيانات العملاء', false, 'overlay'),
        ('/dashboard/templates', 'القوالب', false, 'overlay'),
        ('/dashboard/campaigns', 'الحملات', false, 'overlay'),
        ('/dashboard/widget', 'ويدجت واتساب', false, 'overlay'),
        ('/dashboard/conversion-elements', 'تحسين التحويل', false, 'overlay'),
        ('/dashboard/short-links', 'روابط مختصرة', false, 'overlay'),
        ('/dashboard/ai', 'موظف إسعاد العملاء', false, 'overlay'),
        ('/dashboard/stores', 'المتاجر', false, 'overlay'),
        ('/dashboard/channels', 'القنوات', false, 'overlay'),
        ('/dashboard/analytics', 'التحليلات', false, 'overlay'),
        ('/dashboard/staff', 'الموظفين', false, 'overlay'),
        ('/dashboard/staff/notifications', 'تنبيهات الموظفين', false, 'overlay'),
        ('/dashboard/billing', 'الاشتراكات', false, 'overlay'),
        ('/dashboard/settings', 'الإعدادات', false, 'overlay'),
        ('/dashboard/quick-replies', 'الردود السريعة', false, 'overlay'),
        ('/dashboard/suggestions', 'الاقتراحات', false, 'overlay')
      ON CONFLICT (route) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS maintenance_pages;`);
  }
}
