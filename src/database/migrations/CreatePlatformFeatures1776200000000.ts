import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformFeatures1776200000000 implements MigrationInterface {
  name = 'CreatePlatformFeatures1776200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "platform_feature_target_mode_enum" AS ENUM ('all', 'include', 'exclude')`);
    await queryRunner.query(`CREATE TYPE "platform_feature_status_enum" AS ENUM ('active', 'beta', 'maintenance', 'hidden')`);
    await queryRunner.query(`
      CREATE TABLE "platform_features" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "feature_key" VARCHAR(100) NOT NULL UNIQUE,
        "parent_feature_key" VARCHAR(100),
        "name" VARCHAR(150) NOT NULL,
        "description" VARCHAR(500),
        "category" VARCHAR(80) NOT NULL,
        "route" VARCHAR(255),
        "target_mode" "platform_feature_target_mode_enum" NOT NULL DEFAULT 'all',
        "platforms" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "show_in_navigation" BOOLEAN NOT NULL DEFAULT true,
        "display_order" INTEGER NOT NULL DEFAULT 0,
        "required_permission" VARCHAR(100),
        "required_plan_feature" VARCHAR(100),
        "status" "platform_feature_status_enum" NOT NULL DEFAULT 'active',
        "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_platform_features_order" ON "platform_features" ("display_order")`);
    await queryRunner.query(`CREATE INDEX "idx_platform_features_parent" ON "platform_features" ("parent_feature_key")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_features"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "platform_feature_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "platform_feature_target_mode_enum"`);
  }
}
