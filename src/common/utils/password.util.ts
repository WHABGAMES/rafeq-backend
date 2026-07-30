/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔒 FIX F-21: توحيد تجزئة كلمات المرور على argon2id
 * ───────────────────────────────────────────────────────────────────────────────
 * كانت كلمات مرور التجار تُجزّأ بـ bcryptjs (تنفيذ JS نقي، أبطأ وأضعف من الأصلي).
 * argon2id هو التوصية الحديثة (OWASP) ضد هجمات GPU/ASIC.
 *
 * الهجرة شفافة وآمنة (لا نملك كلمات المرور الأصلية لإعادة تجزئتها):
 *   • كلمات المرور الجديدة → argon2id.
 *   • عند تسجيل الدخول: نكتشف نوع الـ hash تلقائياً ونتحقق بالخوارزمية الصحيحة.
 *   • لو كان الـ hash قديماً (bcrypt) وصحّت كلمة المرور → نعيد تجزئتها بـ argon2id
 *     ونحفظها (rehash-on-login). فيهاجر المستخدمون النشطون تدريجياً دون أي إزعاج.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import * as bcrypt from 'bcryptjs';
import type * as Argon2 from 'argon2';

// 🔒 argon2 مكتبة native — نُحمّلها كسولاً (dynamic import) فقط عند الحاجة الفعلية،
// كي لا يجرّها مجرّد استيراد هذه الأداة إلى مسارات حسّاسة (تحميل الكيانات في
// سياق migrations عبر ts-node مثلاً). bcryptjs (JS نقي) يبقى استيراداً عادياً.
let _argon2: typeof Argon2 | null = null;
async function getArgon2(): Promise<typeof Argon2> {
  if (!_argon2) {
    _argon2 = await import('argon2');
  }
  return _argon2;
}

/** معاملات argon2id (تطابق ما هو مستخدم في admin-auth — توصية OWASP) */
export const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
  raw: false as const, // دائماً يُعيد نصاً
} as const;

/** هل الـ hash بصيغة bcrypt؟ ($2a$ / $2b$ / $2y$) */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

/** هل الـ hash بصيغة argon2؟ ($argon2i$ / $argon2d$ / $argon2id$) */
export function isArgon2Hash(hash: string): boolean {
  return hash.startsWith('$argon2');
}

/** تجزئة كلمة مرور جديدة بـ argon2id */
export async function hashPassword(plain: string): Promise<string> {
  const argon2 = await getArgon2();
  return argon2.hash(plain, { type: argon2.argon2id, ...ARGON2_OPTIONS });
}

/**
 * التحقق من كلمة المرور مقابل hash مخزَّن — يكتشف النوع تلقائياً.
 * يدعم بيانات argon2 الجديدة و bcrypt القديمة خلال فترة الهجرة.
 */
export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    if (isArgon2Hash(storedHash)) {
      const argon2 = await getArgon2();
      return await argon2.verify(storedHash, plain);
    }
    if (isBcryptHash(storedHash)) {
      return await bcrypt.compare(plain, storedHash);
    }
    // صيغة غير معروفة → رفض آمن
    return false;
  } catch {
    return false;
  }
}

/**
 * هل يحتاج الـ hash لإعادة التجزئة إلى argon2id؟
 * (true لو كان bcrypt قديماً — يستدعيه المتصل بعد تحقق ناجح فيهاجر شفافياً)
 */
export function needsRehash(storedHash: string): boolean {
  return !isArgon2Hash(storedHash);
}
