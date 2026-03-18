/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Migration: Conversion Elements System                ║
 * ║                                                                                ║
 * ║  Creates 4 tables:                                                             ║
 * ║  1. conversion_elements    — element definitions + settings                   ║
 * ║  2. element_events         — raw tracking events (partitioned-ready)          ║
 * ║  3. element_analytics_daily — pre-aggregated daily stats                      ║
 * ║  4. ab_tests               — A/B test configurations                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversionElements1711000000000 implements MigrationInterface {
  name = 'CreateConversionElements1711000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {

    // ─── 1. conversion_elements ─────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "element_type_enum" AS ENUM (
        'social_proof', 'urgency_countdown', 'urgency_scarcity',
        'upsell', 'cross_sell', 'smart_offer', 'spin_wheel',
        'whatsapp_cta', 'lead_form', 'free_shipping_bar',
        'announcement_bar', 'sticky_atc', 'trust_badges', 'reviews_widget'
      );

      CREATE TYPE "element_status_enum" AS ENUM (
        'draft', 'active', 'paused', 'archived', 'scheduled'
      );

      CREATE TYPE "element_position_enum" AS ENUM (
        'top_bar', 'bottom_bar', 'bottom_right', 'bottom_left',
        'center_modal', 'slide_in_right', 'slide_in_left',
        'inline', 'floating'
      );

      CREATE TABLE "conversion_elements" (
        "id"                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "store_id"            UUID NOT NULL,
        "tenant_id"           UUID NOT NULL,
        "name"                VARCHAR(255) NOT NULL,
        "type"                element_type_enum NOT NULL,
        "status"              element_status_enum NOT NULL DEFAULT 'draft',
        "position"            element_position_enum NOT NULL DEFAULT 'bottom_right',
        "content"             JSONB NOT NULL DEFAULT '{}',
        "design"              JSONB NOT NULL DEFAULT '{}',
        "behavior"            JSONB NOT NULL DEFAULT '{}',
        "targeting"           JSONB NOT NULL DEFAULT '{}',
        "ab_test_id"          UUID,
        "variant_label"       VARCHAR(10),
        "total_views"         INTEGER NOT NULL DEFAULT 0,
        "total_clicks"        INTEGER NOT NULL DEFAULT 0,
        "total_conversions"   INTEGER NOT NULL DEFAULT 0,
        "total_revenue"       DECIMAL(12,2) NOT NULL DEFAULT 0,
        "starts_at"           TIMESTAMPTZ,
        "ends_at"             TIMESTAMPTZ,
        "platform"            VARCHAR(20),
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at"          TIMESTAMPTZ
      );

      CREATE INDEX "idx_ce_store_status" ON "conversion_elements" ("store_id", "status");
      CREATE INDEX "idx_ce_store_type" ON "conversion_elements" ("store_id", "type");
      CREATE INDEX "idx_ce_tenant" ON "conversion_elements" ("tenant_id");
      CREATE INDEX "idx_ce_status_type" ON "conversion_elements" ("status", "type");
    `);

    // ─── 2. element_events ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "element_events" (
        "id"                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "store_id"          UUID NOT NULL,
        "tenant_id"         UUID NOT NULL,
        "element_id"        UUID NOT NULL,
        "event_type"        VARCHAR(50) NOT NULL,
        "session_id"        VARCHAR(100) NOT NULL,
        "visitor_id"        VARCHAR(100),
        "customer_id"       VARCHAR(100),
        "page_url"          TEXT,
        "page_type"         VARCHAR(50),
        "product_id"        VARCHAR(100),
        "cart_value"        DECIMAL(12,2),
        "cart_items"        INTEGER,
        "order_id"          VARCHAR(100),
        "order_value"       DECIMAL(12,2),
        "device_type"       VARCHAR(20),
        "country"           VARCHAR(5),
        "utm_source"        VARCHAR(100),
        "utm_medium"        VARCHAR(100),
        "utm_campaign"      VARCHAR(100),
        "variant_label"     VARCHAR(10),
        "metadata"          JSONB,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX "idx_ee_store_created" ON "element_events" ("store_id", "created_at");
      CREATE INDEX "idx_ee_element_created" ON "element_events" ("element_id", "created_at");
      CREATE INDEX "idx_ee_store_event_created" ON "element_events" ("store_id", "event_type", "created_at");
      CREATE INDEX "idx_ee_session" ON "element_events" ("session_id");
    `);

    // ─── 3. element_analytics_daily ─────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "element_analytics_daily" (
        "id"                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "store_id"          UUID NOT NULL,
        "tenant_id"         UUID NOT NULL,
        "element_id"        UUID NOT NULL,
        "element_type"      VARCHAR(50) NOT NULL,
        "variant_label"     VARCHAR(10),
        "date"              DATE NOT NULL,
        "views"             INTEGER NOT NULL DEFAULT 0,
        "clicks"            INTEGER NOT NULL DEFAULT 0,
        "closes"            INTEGER NOT NULL DEFAULT 0,
        "submits"           INTEGER NOT NULL DEFAULT 0,
        "cta_clicks"        INTEGER NOT NULL DEFAULT 0,
        "add_to_carts"      INTEGER NOT NULL DEFAULT 0,
        "purchases"         INTEGER NOT NULL DEFAULT 0,
        "revenue"           DECIMAL(14,2) NOT NULL DEFAULT 0,
        "avg_order_value"   DECIMAL(12,2) NOT NULL DEFAULT 0,
        "ctr"               DECIMAL(8,4) NOT NULL DEFAULT 0,
        "conversion_rate"   DECIMAL(8,4) NOT NULL DEFAULT 0,
        "unique_visitors"   INTEGER NOT NULL DEFAULT 0,
        "unique_clickers"   INTEGER NOT NULL DEFAULT 0,
        "mobile_views"      INTEGER NOT NULL DEFAULT 0,
        "desktop_views"     INTEGER NOT NULL DEFAULT 0,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX "idx_ead_store_date" ON "element_analytics_daily" ("store_id", "date");
      CREATE UNIQUE INDEX "idx_ead_element_date" ON "element_analytics_daily" ("element_id", "date");
      CREATE INDEX "idx_ead_store_element_date" ON "element_analytics_daily" ("store_id", "element_id", "date");
    `);

    // ─── 4. ab_tests ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "ab_test_status_enum" AS ENUM ('running', 'completed', 'paused', 'cancelled');

      CREATE TABLE "ab_tests" (
        "id"                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "store_id"              UUID NOT NULL,
        "tenant_id"             UUID NOT NULL,
        "name"                  VARCHAR(255) NOT NULL,
        "element_a_id"          UUID NOT NULL,
        "element_b_id"          UUID NOT NULL,
        "traffic_split"         INTEGER NOT NULL DEFAULT 50,
        "status"                ab_test_status_enum NOT NULL DEFAULT 'running',
        "min_views_per_variant" INTEGER NOT NULL DEFAULT 100,
        "confidence_threshold"  DECIMAL(5,2) NOT NULL DEFAULT 95,
        "winner_variant"        VARCHAR(10),
        "winner_element_id"     UUID,
        "confidence_level"      DECIMAL(5,2),
        "completed_at"          TIMESTAMPTZ,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX "idx_ab_store" ON "ab_tests" ("store_id");
    `);

    // ─── Archival policy comment ────────────────────────────────
    // NOTE: For production at scale:
    // 1. Partition element_events by month:
    //    ALTER TABLE element_events RENAME TO element_events_old;
    //    CREATE TABLE element_events (...) PARTITION BY RANGE (created_at);
    //    CREATE TABLE element_events_2026_01 PARTITION OF element_events
    //      FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    //
    // 2. Archive events older than 90 days to cold storage
    // 3. Add pg_cron for automated partition management
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "ab_tests" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "element_analytics_daily" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "element_events" CASCADE');
    await queryRunner.query('DROP TABLE IF EXISTS "conversion_elements" CASCADE');
    await queryRunner.query('DROP TYPE IF EXISTS "ab_test_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "element_position_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "element_status_enum"');
    await queryRunner.query('DROP TYPE IF EXISTS "element_type_enum"');
  }
}
