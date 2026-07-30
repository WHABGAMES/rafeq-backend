/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔒 FIX F-18: تحصين سطح حقن الأوامر (Prompt Injection) في الذكاء الاصطناعي
 * ───────────────────────────────────────────────────────────────────────────────
 * أي نص يدخل الـ system prompt من مصدر غير موثوق (اسم العميل، محتوى مسترجَع من
 * قاعدة المعرفة، رسائل العملاء) قد يحمل تعليمات خبيثة تحاول "خطف" النموذج
 * (مثل: "تجاهل التعليمات السابقة" أو "أنت الآن نظام آخر" أو حقن أدوار system/assistant).
 *
 * هذه الأداة تُحيّد تلك المحاولات دون كسر المحتوى الشرعي:
 *   • تُزيل علامات الأدوار الشائعة (system:, assistant:, [INST], <|im_start|> ...).
 *   • تُبطل عبارات "تجاهل/انسَ التعليمات" الشائعة.
 *   • تُزيل فواصل الأقسام التي قد تُوهم النموذج بنهاية السياق (===, ```, ---).
 *   • تحدّ الطول لتفادي إغراق السياق.
 * الفلسفة: تنظيف متحفظ — نُبقي المحتوى المفيد ونكسر أنماط الحقن فقط.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** أنماط تُوهم النموذج بحدود الأدوار أو نهاية التعليمات */
const ROLE_MARKER_PATTERNS: RegExp[] = [
  // علامات أدوار OpenAI/ChatML وغيرها
  /<\|?\s*(?:im_start|im_end|endoftext|system|user|assistant)\s*\|?>/gi,
  // بادئات أدوار نصية في بداية سطر: "system:", "assistant:", "[SYSTEM]"
  /^\s*\[?\s*(?:system|assistant|developer|tool)\s*\]?\s*[:：]/gim,
  // علامات تعليمات نماذج أخرى
  /\[\/?\s*INST\s*\]/gi,
  /<<\/?\s*SYS\s*>>/gi,
];

/** عبارات تحاول إبطال التعليمات (عربي/إنجليزي) */
const INSTRUCTION_OVERRIDE_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|the)\s+instructions?/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|the)\s+(?:instructions?|rules?)/gi,
  /forget\s+(?:everything|all|previous|your)\s+(?:instructions?|rules?)?/gi,
  /you\s+are\s+now\s+(?:a\s+)?(?:different|new)\b/gi,
  /(?:تجاهل|انسَ?|تناسَ)\s+(?:كل\s+)?(?:التعليمات|الأوامر|القواعد)(?:\s+السابقة)?/gi,
  /أنت\s+الآن\s+(?:نظام|مساعد|بوت)\s+(?:آخر|مختلف|جديد)/gi,
];

/** فواصل أقسام قد تُوهم بنهاية السياق */
const SECTION_DELIMITER_PATTERN = /(?:={3,}|-{3,}|`{3,}|#{3,})/g;

/**
 * تنظيف نص غير موثوق قبل حقنه في الـ prompt.
 * @param input النص الخام من مصدر غير موثوق
 * @param maxLen الحد الأقصى للطول (افتراضي 2000)
 */
export function sanitizeUntrustedText(input: string | null | undefined, maxLen = 2000): string {
  if (!input || typeof input !== 'string') return '';

  let out = input;

  // 1) إزالة علامات الأدوار
  for (const re of ROLE_MARKER_PATTERNS) out = out.replace(re, ' ');

  // 2) تحييد عبارات إبطال التعليمات (نستبدلها بمسافة، لا نحذف السياق كله)
  for (const re of INSTRUCTION_OVERRIDE_PATTERNS) out = out.replace(re, '[…]');

  // 3) إزالة فواصل الأقسام
  out = out.replace(SECTION_DELIMITER_PATTERN, ' ');

  // 4) تسوية المسافات وأسطر متعددة (يقلّل محاولات التخطيط البصري)
  out = out.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();

  // 5) حدّ الطول
  if (out.length > maxLen) out = out.slice(0, maxLen) + '…';

  return out;
}

/**
 * تنظيف اسم العميل — أكثر صرامة (اسم قصير، بلا أسطر أو رموز تحكّم).
 */
export function sanitizeCustomerName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '';
  // سطر واحد، بلا علامات أدوار/فواصل، طول قصير معقول
  const cleaned = sanitizeUntrustedText(name.replace(/[\r\n]+/g, ' '), 100);
  return cleaned.slice(0, 80).trim();
}
