/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  Migration: Add New Element Types to element_type_enum                        ║
 * ║  For existing databases that already have the conversion_elements tables      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewElementTypes1711100000000 implements MigrationInterface {
  name = 'AddNewElementTypes1711100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL: ALTER TYPE ... ADD VALUE is safe — it's a no-op if value already exists (PG 9.3+)
    // We use IF NOT EXISTS to be idempotent
    const newTypes = [
      'page_visitors',
      'visitors_bar',
      'live_orders',
      'coupon_widget',
      'discount_bar',
      'coupon_alert',
      'whatsapp_bar',
      'store_stories',
      'mini_stories',
      'cookie_policy',
      'ask_product',
      'rate_us',
      'customer_satisfaction',
      'newsletter',
      'mobile_subscribe',
    ];

    for (const type of newTypes) {
      // Check if value already exists before adding
      const exists = await queryRunner.query(
        `SELECT 1 FROM pg_enum WHERE enumlabel = $1 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'element_type_enum')`,
        [type],
      );

      if (!exists || exists.length === 0) {
        await queryRunner.query(
          `ALTER TYPE "element_type_enum" ADD VALUE '${type}'`,
        );
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values
    // This is intentionally left empty — the values are harmless if unused
  }
}
