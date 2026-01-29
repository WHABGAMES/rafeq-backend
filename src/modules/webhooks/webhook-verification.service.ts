/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Webhook Verification Service                   ║
 * ║                                                                                ║
 * ║  خدمة التحقق من صحة الـ Webhooks                                                ║
 * ║  تتأكد أن الـ webhook فعلاً من المصدر المزعوم (مثل سلة)                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * 📌 لماذا التحقق من الـ Webhooks مهم جداً؟
 * 
 * بدون التحقق، أي شخص يمكنه:
 * 1. إرسال webhook مزيف يقول "طلب جديد بمليون ريال"
 * 2. إرسال webhook يحذف بيانات
 * 3. إرسال webhook يغير أسعار
 * 
 * كيف يعمل التحقق؟
 * 
 * 1. عند تسجيل webhook في سلة، تحصل على "secret"
 * 2. سلة تُوقّع كل webhook بهذا الـ secret
 * 3. نحن نحسب التوقيع بنفسنا ونقارن
 * 4. إذا تطابقا = الـ webhook أصلي ✓
 * 5. إذا لم يتطابقا = الـ webhook مزيف ✗
 * 
 * الخوارزمية: HMAC-SHA256
 * 
 * مثال:
 * - Secret: "my-secret-key"
 * - Payload: {"event": "order.created", ...}
 * - Signature = HMAC-SHA256(payload, secret)
 * - Header: X-Salla-Signature: sha256=abc123...
 */

export interface WebhookVerificationResult {
  /** هل التوقيع صحيح؟ */
  isValid: boolean;
  /** سبب الفشل (إذا فشل) */
  failureReason?: string;
  /** التوقيع المُستلم */
  receivedSignature?: string;
  /** التوقيع المحسوب */
  computedSignature?: string;
}

@Injectable()
export class WebhookVerificationService {
  private readonly logger = new Logger(WebhookVerificationService.name);

  constructor(private readonly configService: ConfigService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Salla Webhook Verification
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من webhook من سلة
   * 
   * @param payload - بيانات الـ webhook (JSON string أو Buffer)
   * @param signature - التوقيع من header
   * @param storeSecret - الـ secret الخاص بالمتجر (اختياري، يستخدم الـ default)
   */
  verifySallaWebhook(
    payload: string | Buffer,
    signature: string | undefined,
    storeSecret?: string,
  ): WebhookVerificationResult {
    try {
      // ─────────────────────────────────────────────────────────────────────────────
      // 1️⃣ التحقق من وجود التوقيع
      // ─────────────────────────────────────────────────────────────────────────────
      if (!signature) {
        this.logger.warn('Salla webhook missing signature');
        return {
          isValid: false,
          failureReason: 'Missing signature header',
        };
      }

      // ─────────────────────────────────────────────────────────────────────────────
      // 2️⃣ جلب الـ Secret
      // ─────────────────────────────────────────────────────────────────────────────
      const secret = storeSecret || this.configService.get<string>('salla.webhookSecret');
      
      if (!secret) {
        this.logger.error('Salla webhook secret not configured');
        return {
          isValid: false,
          failureReason: 'Webhook secret not configured',
        };
      }

      // ─────────────────────────────────────────────────────────────────────────────
      // 3️⃣ تحويل الـ Payload إلى string
      // ─────────────────────────────────────────────────────────────────────────────
      const payloadString = Buffer.isBuffer(payload) 
        ? payload.toString('utf8') 
        : payload;

      // ─────────────────────────────────────────────────────────────────────────────
      // 4️⃣ حساب التوقيع
      // ─────────────────────────────────────────────────────────────────────────────
      /**
       * سلة تستخدم HMAC-SHA256
       * 
       * الـ signature header يكون بالشكل:
       * - "sha256=xxxx" أو
       * - "xxxx" فقط
       */
      const computedSignature = this.computeHmacSha256(payloadString, secret);

      // ─────────────────────────────────────────────────────────────────────────────
      // 5️⃣ استخراج التوقيع من الـ Header
      // ─────────────────────────────────────────────────────────────────────────────
      // إزالة prefix إذا موجود
      const receivedSignature = signature.startsWith('sha256=')
        ? signature.substring(7)
        : signature;

      // ─────────────────────────────────────────────────────────────────────────────
      // 6️⃣ المقارنة الآمنة (Timing-safe)
      // ─────────────────────────────────────────────────────────────────────────────
      /**
       * 🔒 لماذا timingSafeEqual؟
       * 
       * المقارنة العادية (===) قد تكشف معلومات عبر الوقت:
       * - إذا أول حرف خاطئ → ترجع فوراً
       * - إذا أول 10 حروف صحيحة → تأخذ وقت أطول
       * 
       * المهاجم يمكنه استغلال هذا لتخمين التوقيع!
       * 
       * timingSafeEqual تأخذ نفس الوقت دائماً
       */
      const isValid = this.timingSafeCompare(receivedSignature, computedSignature);

      if (!isValid) {
        this.logger.warn('Salla webhook signature mismatch', {
          received: receivedSignature.substring(0, 10) + '...',
          computed: computedSignature.substring(0, 10) + '...',
        });
      }

      return {
        isValid,
        receivedSignature,
        computedSignature,
        failureReason: isValid ? undefined : 'Signature mismatch',
      };

    } catch (error) {
      this.logger.error('Error verifying Salla webhook', error);
      return {
        isValid: false,
        failureReason: `Verification error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 WhatsApp Webhook Verification
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من webhook من WhatsApp
   * 
   * WhatsApp يستخدم طريقة مختلفة قليلاً
   */
  verifyWhatsAppWebhook(
    payload: string | Buffer,
    signature: string | undefined,
  ): WebhookVerificationResult {
    try {
      if (!signature) {
        return {
          isValid: false,
          failureReason: 'Missing X-Hub-Signature-256 header',
        };
      }

      const secret = this.configService.get<string>('whatsapp.appSecret');
      
      if (!secret) {
        return {
          isValid: false,
          failureReason: 'WhatsApp app secret not configured',
        };
      }

      const payloadString = Buffer.isBuffer(payload) 
        ? payload.toString('utf8') 
        : payload;

      // WhatsApp يستخدم sha256= prefix
      const computedSignature = 'sha256=' + this.computeHmacSha256(payloadString, secret);
      
      const isValid = this.timingSafeCompare(signature, computedSignature);

      return {
        isValid,
        receivedSignature: signature,
        computedSignature,
        failureReason: isValid ? undefined : 'Signature mismatch',
      };

    } catch (error) {
      return {
        isValid: false,
        failureReason: `Verification error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Stripe Webhook Verification
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من webhook من Stripe
   * 
   * Stripe يستخدم timestamp + signature
   */
  verifyStripeWebhook(
    payload: string | Buffer,
    signature: string | undefined,
  ): WebhookVerificationResult {
    try {
      if (!signature) {
        return {
          isValid: false,
          failureReason: 'Missing Stripe-Signature header',
        };
      }

      const secret = this.configService.get<string>('billing.stripe.webhookSecret');
      
      if (!secret) {
        return {
          isValid: false,
          failureReason: 'Stripe webhook secret not configured',
        };
      }

      // Stripe signature format: t=timestamp,v1=signature
      const elements = signature.split(',');
      const signatureMap: Record<string, string> = {};
      
      for (const element of elements) {
        const [key, value] = element.split('=');
        signatureMap[key] = value;
      }

      const timestamp = signatureMap['t'];
      const receivedSig = signatureMap['v1'];

      if (!timestamp || !receivedSig) {
        return {
          isValid: false,
          failureReason: 'Invalid Stripe signature format',
        };
      }

      // التحقق من أن الـ timestamp ليس قديماً جداً (5 دقائق)
      const tolerance = 300; // 5 minutes
      const now = Math.floor(Date.now() / 1000);
      
      if (now - parseInt(timestamp) > tolerance) {
        return {
          isValid: false,
          failureReason: 'Webhook timestamp too old',
        };
      }

      const payloadString = Buffer.isBuffer(payload) 
        ? payload.toString('utf8') 
        : payload;

      // Stripe signed payload format: timestamp.payload
      const signedPayload = `${timestamp}.${payloadString}`;
      const computedSignature = this.computeHmacSha256(signedPayload, secret);

      const isValid = this.timingSafeCompare(receivedSig, computedSignature);

      return {
        isValid,
        receivedSignature: receivedSig,
        computedSignature,
        failureReason: isValid ? undefined : 'Signature mismatch',
      };

    } catch (error) {
      return {
        isValid: false,
        failureReason: `Verification error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * حساب HMAC-SHA256
   */
  private computeHmacSha256(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  /**
   * مقارنة آمنة زمنياً
   * 
   * تمنع timing attacks
   */
  private timingSafeCompare(a: string, b: string): boolean {
    try {
      // يجب أن يكون الطولان متساويان
      if (a.length !== b.length) {
        // نقارن مع نفسه لضمان نفس الوقت
        crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
        return false;
      }
      
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Idempotency Key Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إنشاء Idempotency Key فريد
   * 
   * يُستخدم لمنع معالجة نفس الحدث مرتين
   */
  generateIdempotencyKey(
    source: string,
    eventType: string,
    externalId: string,
  ): string {
    const data = `${source}:${eventType}:${externalId}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * 📌 ملخص طرق التحقق لكل مصدر:
 * 
 * ┌─────────────┬───────────────────┬─────────────────────────────────────────┐
 * │ المصدر      │ الخوارزمية        │ Header                                   │
 * ├─────────────┼───────────────────┼─────────────────────────────────────────┤
 * │ Salla       │ HMAC-SHA256       │ X-Salla-Signature                       │
 * │ WhatsApp    │ HMAC-SHA256       │ X-Hub-Signature-256                     │
 * │ Stripe      │ HMAC-SHA256 + ts  │ Stripe-Signature (t=xxx,v1=xxx)         │
 * │ Discord     │ Ed25519           │ X-Signature-Ed25519 + X-Signature-Ts    │
 * └─────────────┴───────────────────┴─────────────────────────────────────────┘
 */
