/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  Controller لاستقبال ومعالجة الـ Webhooks من سلة                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';

// Services
import { SallaWebhooksService } from './salla-webhooks.service';
import { WebhookVerificationService } from './webhook-verification.service';

// DTOs
import { SallaWebhookDto } from './dto/salla-webhook.dto';

/**
 * 📌 كيف تعمل Webhooks سلة:
 * 
 * 1. تُسجّل تطبيقك في سلة Developer Portal
 * 2. تحدد URL لاستقبال الـ webhooks (مثل: https://api.rafiq.com/webhooks/salla)
 * 3. تختار الأحداث التي تريد استقبالها
 * 4. سلة تُرسل POST request لكل حدث
 * 
 * شكل الـ Webhook من سلة:
 * {
 *   "event": "order.created",
 *   "merchant": 123456,
 *   "created_at": "2024-01-15T10:30:00Z",
 *   "data": { ... }
 * }
 * 
 * Headers مهمة:
 * - X-Salla-Signature: التوقيع للتحقق
 * - X-Salla-Event: نوع الحدث
 * - X-Salla-Delivery: معرّف التوصيل (للـ idempotency)
 */

@Controller('webhooks/salla')
@ApiTags('Webhooks')
@SkipThrottle() // لا نريد rate limiting على webhooks
export class SallaWebhooksController {
  private readonly logger = new Logger(SallaWebhooksController.name);

  constructor(
    private readonly sallaWebhooksService: SallaWebhooksService,
    private readonly verificationService: WebhookVerificationService,
  ) {}

  /**
   * 🔔 استقبال Webhook من سلة
   * 
   * POST /api/v1/webhooks/salla
   * 
   * هذا الـ endpoint هو الذي تُسجّله في سلة
   */
  @Post()
  @HttpCode(HttpStatus.OK) // دائماً نرجع 200 حتى لو فشلت المعالجة
  @ApiOperation({
    summary: 'استقبال Webhook من سلة',
    description: `
      يستقبل الأحداث من سلة ويعالجها.
      
      **مهم**: هذا الـ endpoint يجب أن يرد بسرعة (< 5 ثواني)
      وإلا سلة ستعتبر الـ webhook فاشل وتعيد الإرسال.
      
      المعالجة الفعلية تتم في الخلفية عبر Queue.
    `,
  })
  @ApiHeader({
    name: 'X-Salla-Signature',
    description: 'توقيع للتحقق من صحة الـ webhook',
    required: true,
  })
  @ApiHeader({
    name: 'X-Salla-Event',
    description: 'نوع الحدث (مثل: order.created)',
    required: false,
  })
  @ApiHeader({
    name: 'X-Salla-Delivery',
    description: 'معرّف التوصيل الفريد',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'تم استقبال الـ webhook بنجاح',
  })
  @ApiResponse({
    status: 401,
    description: 'التوقيع غير صحيح',
  })
  async handleSallaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Body() body: SallaWebhookDto,
    @Headers('x-salla-signature') signature: string,
    @Headers('x-salla-event') eventHeader: string,
    @Headers('x-salla-delivery') deliveryId: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // ═══════════════════════════════════════════════════════════════════════════════
      // 1️⃣ تسجيل استقبال الـ Webhook
      // ═══════════════════════════════════════════════════════════════════════════════
      
      const eventType = body.event || eventHeader;
      
      this.logger.log(`📥 Received Salla webhook: ${eventType}`, {
        deliveryId,
        merchant: body.merchant,
      });

      // ═══════════════════════════════════════════════════════════════════════════════
      // 2️⃣ التحقق من التوقيع
      // ═══════════════════════════════════════════════════════════════════════════════
      
      /**
       * نستخدم raw body للتحقق من التوقيع
       * لأن أي تعديل (حتى formatting) يغير التوقيع
       */
      const rawBody = req.rawBody || JSON.stringify(body);
      
      // البحث عن secret المتجر المحدد (إذا كان لكل متجر secret مختلف)
      const storeSecret = await this.sallaWebhooksService.getStoreSecret(body.merchant);
      
      const verification = this.verificationService.verifySallaWebhook(
        rawBody,
        signature,
        storeSecret,
      );

      if (!verification.isValid) {
        this.logger.warn(`❌ Invalid Salla webhook signature`, {
          deliveryId,
          reason: verification.failureReason,
        });
        
        // نرجع 200 حتى لو التوقيع خاطئ
        // لكن لا نعالج الـ webhook
        // (بعض الشركات ترجع 401، لكن هذا قد يسبب إعادة إرسال لا نهائية)
        res.status(HttpStatus.OK).json({
          received: true,
          processed: false,
          reason: 'Invalid signature',
        });
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════════════
      // 3️⃣ التحقق من عدم التكرار (Idempotency)
      // ═══════════════════════════════════════════════════════════════════════════════
      
      const idempotencyKey = this.verificationService.generateIdempotencyKey(
        'salla',
        eventType,
        deliveryId || body.data?.id?.toString() || Date.now().toString(),
      );

      const isDuplicate = await this.sallaWebhooksService.checkDuplicate(idempotencyKey);

      if (isDuplicate) {
        this.logger.log(`🔄 Duplicate Salla webhook, skipping`, {
          deliveryId,
          eventType,
        });
        
        res.status(HttpStatus.OK).json({
          received: true,
          processed: false,
          reason: 'Duplicate event',
        });
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════════════
      // 4️⃣ إضافة للـ Queue للمعالجة
      // ═══════════════════════════════════════════════════════════════════════════════
      
      /**
       * 🚀 هنا السر!
       * 
       * بدلاً من معالجة الـ webhook الآن، نضيفه للـ Queue
       * - نرد على سلة فوراً (< 100ms)
       * - المعالجة تتم في الخلفية
       * - إذا فشلت، الـ Queue يعيد المحاولة
       */
      const jobId = await this.sallaWebhooksService.queueWebhook({
        eventType,
        merchant: body.merchant,
        data: body.data,
        createdAt: body.created_at,
        deliveryId,
        idempotencyKey,
        signature,
        ipAddress: req.ip,
        headers: this.extractRelevantHeaders(req),
      });

      // ═══════════════════════════════════════════════════════════════════════════════
      // 5️⃣ الرد على سلة
      // ═══════════════════════════════════════════════════════════════════════════════
      
      const duration = Date.now() - startTime;
      
      this.logger.log(`✅ Salla webhook queued in ${duration}ms`, {
        deliveryId,
        eventType,
        jobId,
      });

      res.status(HttpStatus.OK).json({
        received: true,
        processed: true, // تم وضعه في الـ queue
        jobId,
        duration: `${duration}ms`,
      });

    } catch (error) {
      // ═══════════════════════════════════════════════════════════════════════════════
      // ❌ معالجة الأخطاء
      // ═══════════════════════════════════════════════════════════════════════════════
      
      const duration = Date.now() - startTime;
      
      this.logger.error(`❌ Error handling Salla webhook in ${duration}ms`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryId,
        stack: error instanceof Error ? error.stack : undefined,
      });

      /**
       * 🔒 مهم: نرجع 200 حتى عند الخطأ!
       * 
       * لماذا؟
       * - إذا رجعنا 500، سلة ستعيد الإرسال
       * - هذا قد يسبب loop من الأخطاء
       * - نسجّل الخطأ ونتعامل معه داخلياً
       */
      res.status(HttpStatus.OK).json({
        received: true,
        processed: false,
        error: 'Internal processing error',
      });
    }
  }

  /**
   * 🔍 Verification Endpoint (لسلة للتحقق من الـ URL)
   * 
   * بعض الأنظمة تُرسل GET request أولاً للتحقق من أن الـ URL شغال
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من صحة الـ endpoint' })
  verifyEndpoint(): { status: string; message: string } {
    return {
      status: 'ok',
      message: 'Webhook endpoint is ready',
    };
  }

  /**
   * استخراج الـ Headers المهمة
   */
  private extractRelevantHeaders(req: Request): Record<string, string> {
    const relevantHeaders = [
      'x-salla-signature',
      'x-salla-event',
      'x-salla-delivery',
      'x-forwarded-for',
      'user-agent',
      'content-type',
    ];

    const headers: Record<string, string> = {};

    for (const header of relevantHeaders) {
      const value = req.headers[header];
      if (value) {
        headers[header] = Array.isArray(value) ? value[0] : value;
      }
    }

    return headers;
  }
}

/**
 * 📌 ملاحظات مهمة:
 * 
 * 1. وقت الاستجابة:
 *    - سلة تنتظر 5 ثواني كحد أقصى
 *    - إذا تأخرنا = سلة تعتبر الـ webhook فاشل
 *    - الحل: نضيف للـ Queue ونرد فوراً
 * 
 * 2. Idempotency:
 *    - سلة قد تُرسل نفس الـ webhook أكثر من مرة
 *    - نتحقق من deliveryId لمنع المعالجة المتكررة
 * 
 * 3. Error Handling:
 *    - دائماً نرجع 200
 *    - الأخطاء نسجّلها ونتعامل معها داخلياً
 *    - إذا رجعنا 500، سلة ستعيد الإرسال بلا توقف
 * 
 * 4. Security:
 *    - نتحقق من التوقيع قبل أي شيء
 *    - نستخدم raw body للتحقق
 *    - لا نثق بأي header أو body بدون تحقق
 */
