/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhook DTOs                               ║
 * ║                                                                                ║
 * ║  ✅ v3: مُبسّط — الـ Controller يستخدم Record<string, any>                     ║
 * ║  لأن زد لا يرسل "event" — يرسل بيانات الكيان مباشرة                           ║
 * ║  الـ DTO الوحيد المستخدم هو ZidWebhookJobDto (للـ Queue الداخلي)               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 Internal Queue DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات الـ Job في الـ Queue لزد
 * يُنشأ في الـ Controller بعد اكتشاف نوع الحدث من البيانات الخام
 */
export class ZidWebhookJobDto {
  /** نوع الحدث المكتشف (order.status.update, order.create, etc.) */
  eventType: string;

  /** معرّف المتجر في زد */
  storeId: string;

  /** بيانات الحدث الكاملة كما جاءت من زد */
  data: Record<string, unknown>;

  /** وقت الحدث */
  triggeredAt: string;

  /** معرّف التسليم من زد */
  deliveryId?: string;

  /** مفتاح منع التكرار */
  idempotencyKey: string;

  /** التوقيع */
  signature?: string;

  /** عنوان IP */
  ipAddress?: string;

  /** الهيدرز */
  headers?: Record<string, string>;
}
