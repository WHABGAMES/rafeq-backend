import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubscriptionTables1773300000000 implements MigrationInterface {
  name = 'CreateSubscriptionTables1773300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. ENUMS ──────────────────────────────────────────────────────────────
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE plan_type_enum AS ENUM ('free','paid','trial','custom'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE plan_status_enum AS ENUM ('active','inactive','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE subscription_status_enum AS ENUM ('trialing','active','past_due','suspended','cancelling','cancelled','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE billing_interval_enum AS ENUM ('monthly','quarterly','semi_annual','yearly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await queryRunner.query(`DO $$ BEGIN CREATE TYPE payment_provider_enum AS ENUM ('stripe','moyasar','bank_transfer','manual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

    // ─── 2. subscription_plans ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) NOT NULL,
        description TEXT,
        type plan_type_enum NOT NULL DEFAULT 'paid',
        status plan_status_enum NOT NULL DEFAULT 'active',
        pricing JSONB NOT NULL DEFAULT '{}',
        features JSONB NOT NULL DEFAULT '{}',
        feature_list JSONB NOT NULL DEFAULT '[]',
        trial_days INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        display_order INTEGER NOT NULL DEFAULT 0,
        is_visible BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_slug ON subscription_plans (slug)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscription_plans_type_status ON subscription_plans (type, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscription_plans_status ON subscription_plans (status)`);

    // ─── 3. subscriptions ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        plan_id UUID NOT NULL,
        status subscription_status_enum NOT NULL DEFAULT 'trialing',
        billing_interval billing_interval_enum NOT NULL DEFAULT 'monthly',
        started_at TIMESTAMPTZ,
        trial_ends_at TIMESTAMPTZ,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        currency VARCHAR(5) NOT NULL DEFAULT 'SAR',
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        payment_provider payment_provider_enum,
        payment_methods JSONB NOT NULL DEFAULT '[]',
        usage_stats JSONB NOT NULL DEFAULT '{"messagesUsed":0,"messagesLimit":0,"storesCount":0,"storesLimit":0,"usersCount":0,"usersLimit":0,"storageUsed":0,"storageLimit":0,"lastUpdated":null}',
        billing_info JSONB,
        auto_renew BOOLEAN NOT NULL DEFAULT true,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT fk_subscription_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        CONSTRAINT fk_subscription_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON subscriptions (tenant_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_period ON subscriptions (tenant_id, current_period_end)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status)`);

    // ─── 4. Seed default plans ─────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO subscription_plans (name, slug, type, status, pricing, features, feature_list, trial_days, display_order, is_visible)
      VALUES
        ('أساسي', 'basic', 'paid', 'active',
         '{"currency":"SAR","monthlyPrice":49,"yearlyPrice":468,"yearlyDiscount":20}',
         '{"monthlyMessages":1000,"maxStores":3,"maxUsers":3,"maxWhatsAppChannels":2,"maxInstagramChannels":1,"maxDiscordChannels":1,"maxActiveCampaigns":10,"maxTemplates":20,"storageLimit":1000,"aiSupport":false,"advancedAnalytics":false,"apiAccess":false,"customWebhooks":false,"dataExport":false,"prioritySupport":false,"dedicatedAccountManager":false,"whiteLabel":false,"ssoEnabled":false,"auditLogs":false}',
         '["1,000 رسالة/شهر","إشعارات الطلبات","قوالب جاهزة"]',
         0, 1, true),
        ('احترافي', 'professional', 'paid', 'active',
         '{"currency":"SAR","monthlyPrice":69,"yearlyPrice":660,"yearlyDiscount":20}',
         '{"monthlyMessages":10000,"maxStores":10,"maxUsers":10,"maxWhatsAppChannels":5,"maxInstagramChannels":3,"maxDiscordChannels":2,"maxActiveCampaigns":50,"maxTemplates":100,"storageLimit":5000,"aiSupport":true,"advancedAnalytics":true,"apiAccess":true,"customWebhooks":true,"dataExport":true,"prioritySupport":true,"dedicatedAccountManager":false,"whiteLabel":false,"ssoEnabled":false,"auditLogs":true}',
         '["10,000 رسالة/شهر","بوت الذكاء الاصطناعي","تحليلات متقدمة"]',
         0, 2, true)
      ON CONFLICT (slug) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS subscriptions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS subscription_plans CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS payment_provider_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS billing_interval_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS subscription_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS plan_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS plan_type_enum`);
  }
}
