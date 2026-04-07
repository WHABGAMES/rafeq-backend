import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtpMethod1775550000000 implements MigrationInterface {
  name = 'AddOtpMethod1775550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE otp_configs
        ADD COLUMN IF NOT EXISTS otp_method VARCHAR(20) DEFAULT 'email',
        ADD COLUMN IF NOT EXISTS telegram_bot_flow_id VARCHAR(50),
        ADD COLUMN IF NOT EXISTS compensation_method VARCHAR(20) DEFAULT 'auto';
    `);
    await queryRunner.query(`
      ALTER TABLE otp_configs
        ADD COLUMN IF NOT EXISTS employee_emails TEXT;
    `);
    await queryRunner.query(`
      ALTER TABLE otp_compensations
        ADD COLUMN IF NOT EXISTS method VARCHAR(20) DEFAULT 'auto',
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed',
        ADD COLUMN IF NOT EXISTS reason TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE otp_compensations
        DROP COLUMN IF EXISTS method,
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS reason;
    `);
    await queryRunner.query(`
      ALTER TABLE otp_configs
        DROP COLUMN IF EXISTS otp_method,
        DROP COLUMN IF EXISTS telegram_bot_flow_id,
        DROP COLUMN IF EXISTS compensation_method;
    `);
  }
}
