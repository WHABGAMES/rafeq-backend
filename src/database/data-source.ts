/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           RAFIQ PLATFORM — TypeORM DataSource (CLI Migrations)                ║
 * ║                                                                                ║
 * ║  هذا الملف مخصص لـ TypeORM CLI فقط:                                          ║
 * ║    npm run migration:run                                                       ║
 * ║    npm run migration:generate                                                  ║
 * ║    npm run migration:revert                                                    ║
 * ║                                                                                ║
 * ║  ملاحظة: النظام الحي (NestJS) يستخدم typeorm.config.ts                        ║
 * ║  هذا الملف يُكرّر نفس الإعدادات ليدعم CLI بشكل مستقل                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

/// <reference types="node" />
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadCACert(): Buffer | undefined {
  const b64 = process.env.DB_CA_CERT;
  if (b64) return Buffer.from(b64, 'base64');

  const certPath = process.env.DB_CA_CERT_PATH;
  if (certPath) {
    try { return fs.readFileSync(path.resolve(certPath)); } catch {}
  }
  return undefined;
}

function buildSslConfig(): boolean | Record<string, unknown> {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction && process.env.DB_SSL !== 'true') return false;

  const ca = loadCACert();
  return ca
    ? { rejectUnauthorized: true, ca }
    : { rejectUnauthorized: false };
}

// ─── DataSource ──────────────────────────────────────────────────────────────

const AppDataSource = new DataSource({
  type: 'postgres',
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'rafiq_db',
  username: process.env.DB_USERNAME || 'rafiq_user',
  password: process.env.DB_PASSWORD || '',
  ssl: buildSslConfig(),

  // ─── Entities ────────────────────────────────────────────────────────────
  // يُحمّل كل entities تلقائياً من مساراتها المعروفة
  entities: [
    path.join(__dirname, 'entities', '*.entity.{ts,js}'),
    path.join(__dirname, '..', 'modules', '**', 'entities', '*.entity.{ts,js}'),
  ],

  // ─── Migrations ──────────────────────────────────────────────────────────
  // يُحمّل كل migrations من مجلد واحد — مرتّبة بالـ timestamp في اسم الملف
  migrations: [
    path.join(__dirname, 'migrations', '*.{ts,js}'),
  ],

  migrationsTableName: 'typeorm_migrations',

  // ✅ NEVER synchronize — always use migrations
  synchronize: false,

  logging: ['migration', 'error'],
});

export default AppDataSource;
