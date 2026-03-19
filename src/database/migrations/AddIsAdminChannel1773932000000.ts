import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: Add is_admin_channel flag to channels table                       ║
 * ║                                                                                ║
 * ║  🔥 إصلاح حرج: رقم الإدارة العليا كان يظهر في قنوات التجار                  ║
 * ║                                                                                ║
 * ║  1. إضافة عمود is_admin_channel (default false)                               ║
 * ║  2. تحديث القنوات الموجودة التي تبدأ بـ 'Admin WhatsApp' لتكون admin          ║
 * ║  3. إضافة index للفلترة السريعة                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
export class AddIsAdminChannel1773932000000 implements MigrationInterface {
  name = 'AddIsAdminChannel1773932000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. إضافة العمود
    await queryRunner.query(`
      ALTER TABLE channels 
      ADD COLUMN IF NOT EXISTS is_admin_channel BOOLEAN NOT NULL DEFAULT false
    `);

    // 2. تحديث القنوات الإدارية الموجودة حالياً
    await queryRunner.query(`
      UPDATE channels 
      SET is_admin_channel = true 
      WHERE name LIKE 'Admin WhatsApp%'
         OR name LIKE 'admin WhatsApp%'
    `);

    // 3. تحديث أيضاً حسب whatsapp_settings (أدق)
    await queryRunner.query(`
      UPDATE channels c
      SET is_admin_channel = true
      FROM whatsapp_settings ws
      WHERE c.whatsapp_phone_number_id = ws.phone_number_id
        AND ws.is_active = true
        AND c.is_admin_channel = false
    `);

    // 4. Index للفلترة السريعة
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_channels_is_admin 
      ON channels (is_admin_channel) 
      WHERE is_admin_channel = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_channels_is_admin`);
    await queryRunner.query(`ALTER TABLE channels DROP COLUMN IF EXISTS is_admin_channel`);
  }
}
