/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Encryption Utility                         ║
 * ║                                                                                ║
 * ║  🔐 AES-256-GCM - تشفير التوكنات والبيانات الحساسة                            ║
 * ║                                                                                ║
 * ║  📁 src/common/utils/encryption.util.ts                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;       // 16 bytes = 128 bits
const AUTH_TAG_LENGTH = 16; // 16 bytes = 128 bits
const KEY_LENGTH = 32;      // 32 bytes = 256 bits

/**
 * جلب مفتاح التشفير من البيئة
 * المفتاح يجب أن يكون 64 حرف hex (32 bytes)
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.STORE_ENCRYPTION_KEY;

  if (!keyHex) {
    // في بيئة التطوير: إنشاء مفتاح مؤقت مع تحذير
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '⚠️ [DEV] STORE_ENCRYPTION_KEY not set. Using derived key from APP_SECRET. ' +
        'Set STORE_ENCRYPTION_KEY in production!',
      );
      const appSecret = process.env.APP_SECRET || 'dev-fallback-secret';
      return crypto.createHash('sha256').update(appSecret).digest();
    }
    throw new Error(
      '🚨 FATAL: STORE_ENCRYPTION_KEY is required in production. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  if (keyHex.length !== 64) {
    throw new Error(
      `STORE_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${keyHex.length} chars.`,
    );
  }

  return Buffer.from(keyHex, 'hex');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 Encryption Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * تشفير نص باستخدام AES-256-GCM
 * 
 * الناتج: iv:authTag:encryptedData (كلها hex)
 * 
 * @param plainText - النص المراد تشفيره
 * @returns النص المشفّر أو null إذا كان المدخل فارغاً
 */
export function encrypt(plainText: string | null | undefined): string | null {
  if (!plainText) return null;

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * فك تشفير نص مشفّر بـ AES-256-GCM
 * 
 * @param encryptedText - النص المشفّر (iv:authTag:data)
 * @returns النص الأصلي أو null
 */
export function decrypt(encryptedText: string | null | undefined): string | null {
  if (!encryptedText) return null;

  // إذا لم يكن بالتنسيق المتوقع (نص غير مشفّر قديم)، أرجعه كما هو
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // هذا نص غير مشفر (بيانات قديمة من قبل التشفير)
    return encryptedText;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      // تنسيق غير صالح - ربما نص قديم غير مشفر
      return encryptedText;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // إذا فشل فك التشفير، ربما النص غير مشفر (بيانات قديمة)
    console.warn('Decryption failed, returning raw value (might be unencrypted legacy data)');
    return encryptedText;
  }
}

/**
 * إخفاء نص حساس للعرض
 * مثال: "sk_live_abc123xyz" → "sk_l***z"
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '***';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 4)}***${value.slice(-1)}`;
}

/**
 * التحقق من أن النص مشفّر بالتنسيق الصحيح
 */
export function isEncrypted(text: string | null | undefined): boolean {
  if (!text) return false;
  const parts = text.split(':');
  if (parts.length !== 3) return false;
  // تحقق أن الأجزاء hex صالحة
  return (
    parts[0].length === IV_LENGTH * 2 &&
    parts[1].length === AUTH_TAG_LENGTH * 2 &&
    /^[0-9a-f]+$/i.test(parts[0]) &&
    /^[0-9a-f]+$/i.test(parts[1]) &&
    /^[0-9a-f]+$/i.test(parts[2])
  );
}
