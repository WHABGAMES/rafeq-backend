/**
 * FIX #4: Atomic Idempotency — UNIQUE index على webhook_events.idempotency_key
 *
 * ⚠️ IMPORTANT — لماذا بدون CONCURRENTLY:
 *   PostgreSQL لا يسمح بـ CREATE INDEX CONCURRENTLY داخل transaction block
 *   TypeORM يُشغّل migrations داخل transaction بشكل افتراضي
 *   الحل: بدون CONCURRENTLY — Migration تعمل بشكل صحيح مع lock قصير على الجدول
 *   للإنتاج الحقيقي بجداول كبيرة: شغّل يدوياً خارج TypeORM بـ CONCURRENTLY
 *
 * ما يفعله:
 *   1. UNIQUE partial index على idempotency_key (null values مستثناة)
 *   2. Composite index لتسريع checkDuplicate query (idempotency_key + status)
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookIdempotencyIndex1773200000000 implements MigrationInterface {
  name = 'AddWebhookIdempotencyIndex1773200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // UNIQUE constraint — يمنع حفظ نفس idempotency_key مرتين
    // IF NOT EXISTS يضمن idempotency للـ migration نفسها
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_webhook_events_idempotency_key"
      ON "webhook_events" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);

    // Composite index لتسريع checkDuplicate query
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_events_idempotency_status"
      ON "webhook_events" ("idempotency_key", "status")
      WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_webhook_events_idempotency_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_webhook_events_idempotency_key"`);
  }
}
