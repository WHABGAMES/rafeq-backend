import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtpMethod1775550000000 implements MigrationInterface {
  name = 'AddOtpMethod1775550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE otp_configs
        ADD COLUMN IF NOT EXISTS otp_method VARCHAR(20) DEFAULT 'email',
        ADD COLUMN IF NOT EXISTS telegram_bot_flow_id VARCHAR(50);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE otp_configs
        DROP COLUMN IF EXISTS otp_method,
        DROP COLUMN IF EXISTS telegram_bot_flow_id;
    `);
  }
}
