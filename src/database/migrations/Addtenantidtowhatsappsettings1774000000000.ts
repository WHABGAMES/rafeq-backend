import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ✅ FIX: إضافة tenant_id لجدول whatsapp_settings
 *
 * المشكلة: جدول whatsapp_settings كان عام (بدون tenant_id)
 * كل التجار يشاركون نفس الإعدادات — رقم واتساب واحد يظهر لكل المتاجر
 *
 * الحل: إضافة tenant_id مع unique constraint
 * كل تاجر يكون عنده سجل إعدادات مستقل
 */
export class AddTenantIdToWhatsappSettings1774000000000 implements MigrationInterface {
  name = 'AddTenantIdToWhatsappSettings1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Step 1: إضافة العمود ──
    await queryRunner.query(`
      ALTER TABLE whatsapp_settings
      ADD COLUMN IF NOT EXISTS tenant_id UUID;
    `);

    // ── Step 2: إنشاء Index للبحث السريع ──
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_settings_tenant_id
      ON whatsapp_settings (tenant_id);
    `);

    // ── Step 3: إنشاء Unique Index — كل تاجر يكون عنده سجل واحد ──
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_settings_tenant_unique
      ON whatsapp_settings (tenant_id)
      WHERE tenant_id IS NOT NULL;
    `);

    // ── Step 4: ربط السجل الحالي (إذا موجود) بأول tenant ──
    // هذا يضمن أن الإعدادات الحالية ما تضيع
    await queryRunner.query(`
      UPDATE whatsapp_settings ws
      SET tenant_id = (
        SELECT t.id FROM tenants t
        LIMIT 1
      )
      WHERE ws.tenant_id IS NULL
        AND EXISTS (SELECT 1 FROM tenants LIMIT 1);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_whatsapp_settings_tenant_unique;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_whatsapp_settings_tenant_id;`);
    await queryRunner.query(`ALTER TABLE whatsapp_settings DROP COLUMN IF EXISTS tenant_id;`);
  }
}
