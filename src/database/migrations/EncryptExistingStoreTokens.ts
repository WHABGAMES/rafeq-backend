/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Encrypt Existing Store Tokens                    ║
 * ║                                                                                ║
 * ║  🔐 Migration: تشفير التوكنات الموجودة كنص عادي                               ║
 * ║  يشتغل مرة واحدة فقط - يشفّر البيانات القديمة                                ║
 * ║                                                                                ║
 * ║  📁 src/database/migrations/EncryptExistingStoreTokens.ts                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { MigrationInterface, QueryRunner } from 'typeorm';
import * as crypto from 'crypto';

/**
 * ⚠️ تنبيه: يجب تعيين STORE_ENCRYPTION_KEY قبل تشغيل هذا الـ Migration
 * 
 * إنشاء مفتاح:
 * node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export class EncryptExistingStoreTokens1707300000000 implements MigrationInterface {
  name = 'EncryptExistingStoreTokens1707300000000';

  // AES-256-GCM Encryption (مطابق لـ encryption.util.ts)
  private encrypt(plainText: string): string {
    const keyHex = process.env.STORE_ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error('STORE_ENCRYPTION_KEY must be set before running this migration');
    }

    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private isAlreadyEncrypted(text: string): boolean {
    const parts = text.split(':');
    if (parts.length !== 3) return false;
    return (
      parts[0].length === 32 &&
      parts[1].length === 32 &&
      /^[0-9a-f]+$/i.test(parts[0]) &&
      /^[0-9a-f]+$/i.test(parts[1])
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // جلب كل المتاجر التي لديها tokens
    const stores = await queryRunner.query(`
      SELECT id, access_token, refresh_token 
      FROM stores 
      WHERE access_token IS NOT NULL 
         OR refresh_token IS NOT NULL
    `);

    if (!stores || stores.length === 0) {
      console.log('No stores with tokens found. Skipping encryption.');
      return;
    }

    console.log(`Found ${stores.length} stores with tokens to encrypt...`);

    let encrypted = 0;
    let skipped = 0;

    for (const store of stores) {
      let accessToken = store.access_token;
      let refreshToken = store.refresh_token;
      let needsUpdate = false;

      // تشفير access_token إذا كان نص عادي
      if (accessToken && !this.isAlreadyEncrypted(accessToken)) {
        accessToken = this.encrypt(accessToken);
        needsUpdate = true;
      }

      // تشفير refresh_token إذا كان نص عادي
      if (refreshToken && !this.isAlreadyEncrypted(refreshToken)) {
        refreshToken = this.encrypt(refreshToken);
        needsUpdate = true;
      }

      if (needsUpdate) {
        await queryRunner.query(
          `UPDATE stores SET access_token = $1, refresh_token = $2 WHERE id = $3`,
          [accessToken, refreshToken, store.id],
        );
        encrypted++;
      } else {
        skipped++;
      }
    }

    console.log(`✅ Encryption complete: ${encrypted} encrypted, ${skipped} already encrypted/skipped`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // ⚠️ لا يمكن التراجع عن التشفير بأمان
    // لكن decrypt() في encryption.util.ts يتعامل مع كلا التنسيقين
    console.log(
      '⚠️ Cannot reverse encryption. The decrypt() function handles both formats gracefully.',
    );
  }
}
