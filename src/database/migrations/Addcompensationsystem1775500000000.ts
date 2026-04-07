import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompensationSystem1775500000000 implements MigrationInterface {
  name = 'AddCompensationSystem1775500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ═══ 1. Add compensation columns to otp_configs ═══
    await queryRunner.query(`
      ALTER TABLE otp_configs
        ADD COLUMN IF NOT EXISTS compensation_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS max_compensations_per_order INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS compensation_button_text VARCHAR(100) DEFAULT 'طلب تعويض',
        ADD COLUMN IF NOT EXISTS compensation_success_msg TEXT DEFAULT 'تم تعويضك بحساب جديد بنجاح ✅',
        ADD COLUMN IF NOT EXISTS compensation_empty_msg TEXT DEFAULT 'عذراً، لا توجد حسابات متاحة حالياً. تواصل مع الدعم.',
        ADD COLUMN IF NOT EXISTS compensation_limit_msg TEXT DEFAULT 'تم استنفاد عدد التعويضات المسموحة لهذا الطلب.',
        ADD COLUMN IF NOT EXISTS compensation_notify_employee BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS compensation_employee_template TEXT,
        ADD COLUMN IF NOT EXISTS compensation_notify_customer BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS compensation_customer_template TEXT,
        ADD COLUMN IF NOT EXISTS inventory_total INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS inventory_available INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_compensations INTEGER DEFAULT 0;
    `);

    // ═══ 2. Create inventory items table ═══
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS otp_inventory_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_id UUID NOT NULL,
        tenant_id UUID NOT NULL,
        store_id UUID NOT NULL,
        account_data TEXT NOT NULL,
        account_label VARCHAR(100),
        notes VARCHAR(500),
        status VARCHAR(20) DEFAULT 'available',
        assigned_to_order VARCHAR(100),
        assigned_to_username VARCHAR(255),
        assigned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inventory_config_status ON otp_inventory_items (config_id, status);
      CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON otp_inventory_items (tenant_id, config_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_order ON otp_inventory_items (assigned_to_order, config_id);
    `);

    // ═══ 3. Create compensations table ═══
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS otp_compensations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_id UUID NOT NULL,
        tenant_id UUID NOT NULL,
        store_id UUID NOT NULL,
        inventory_item_id UUID NOT NULL,
        order_number VARCHAR(100) NOT NULL,
        username VARCHAR(255),
        account_data_snapshot TEXT NOT NULL,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(20),
        client_ip VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_comp_config_order ON otp_compensations (config_id, order_number);
      CREATE INDEX IF NOT EXISTS idx_comp_tenant ON otp_compensations (tenant_id, created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS otp_compensations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS otp_inventory_items;`);
    await queryRunner.query(`
      ALTER TABLE otp_configs
        DROP COLUMN IF EXISTS compensation_enabled,
        DROP COLUMN IF EXISTS max_compensations_per_order,
        DROP COLUMN IF EXISTS compensation_button_text,
        DROP COLUMN IF EXISTS compensation_success_msg,
        DROP COLUMN IF EXISTS compensation_empty_msg,
        DROP COLUMN IF EXISTS compensation_limit_msg,
        DROP COLUMN IF EXISTS compensation_notify_employee,
        DROP COLUMN IF EXISTS compensation_employee_template,
        DROP COLUMN IF EXISTS compensation_notify_customer,
        DROP COLUMN IF EXISTS compensation_customer_template,
        DROP COLUMN IF EXISTS inventory_total,
        DROP COLUMN IF EXISTS inventory_available,
        DROP COLUMN IF EXISTS total_compensations;
    `);
  }
}
