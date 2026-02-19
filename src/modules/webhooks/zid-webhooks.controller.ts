/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhooks Controller                        ║
 * ║                                                                                ║
 * ║  ✅ v4: Security Model - IP Validation (Zid Platform Standard)                ║
 * ║  زد لا يرسل "event" — يرسل بيانات الطلب/العميل مباشرة                         ║
 * ║  الـ Controller يكتشف نوع الحدث من بنية البيانات                               ║
 * ║                                                                                ║
 * ║  🔐 SECURITY LAYERS:                                                           ║
 * ║  1. WebhookIpGuard - IP allowlisting (primary security)                        ║
 * ║  2. OAuth 2.0 - Webhook registration authentication                            ║
 * ║                                                                                ║
 * ║  ⚠️ NOTE: Zid does NOT send HMAC signatures (unlike Salla/Shopify)           ║
 * ║  Security via OAuth + IP validation (documented Zid platform behavior)        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

import { ZidWebhooksService } from './zid-webhooks.service';
import { ZidWebhookJobDto } from './dto/zid-webhook.dto';
import { WebhookIpGuard } from './guards/webhook-ip.guard';

@ApiTags('Webhooks - Zid')
@Controller('webhooks/zid')
@UseGuards(WebhookIpGuard) // ✅ IP allowlist - primary security layer for Zid
export class ZidWebhooksController {
  private readonly logger = new Logger(ZidWebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly webhooksService: ZidWebhooksService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('ZID_WEBHOOK_SECRET') ||
      this.configService.get<string>('zid.webhookSecret') ||
      '';

    if (this.webhookSecret) {
      this.logger.log(`🔐 Zid webhook secret loaded (length: ${this.webhookSecret.length}) — used only if Zid sends signature`);
    } else {
      // ⚠️ Zid does NOT send HMAC signatures — secret is optional and reserved for future use
      this.logger.log('📝 ZID_WEBHOOK_SECRET not set — Zid does not send webhook signatures (expected)');
    }
  }

  /**
   * 🔔 التحقق من نقطة الـ Webhook (GET)
   * زد يرسل GET ping عند تسجيل webhook جديد للتحقق من أن الرابط يعمل
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zid webhook endpoint verification' })
  verifyWebhook(): { success: boolean; message: string; endpoint: string } {
    this.logger.log('🔔 Zid webhook verification ping received');
    return {
      success: true,
      message: 'Zid webhook endpoint is active',
      endpoint: '/api/webhooks/zid',
    };
  }

  /**
   * 🔔 استقبال Webhooks من زد
   *
   * ⚠️ زد لا يرسل حقل "event" في الـ body
   * يرسل بيانات الكيان مباشرة (طلب/عميل/منتج)
   * نكتشف نوع الحدث من بنية البيانات
   *
   * مثال payload حقيقي من زد عند تغيير حالة طلب:
   * {
   *   "id": 65179524,
   *   "store_id": 3078847,
   *   "order_status": "جاهز",
   *   "display_status": {...},
   *   "customer": { "id": 123, "name": "أحمد", "mobile": "0500..." },
   *   "products": [...],
   *   "order_total": {...},
   *   ...
   * }
   *
   * 🔑 نستخدم Record<string, any> بدل DTO class
   * لأن NestJS Global ValidationPipe يتخطى Object types
   * وبالتالي لا يرفض الحقول الزائدة من زد
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Zid webhooks' })
  @ApiHeader({ name: 'x-zid-signature', description: 'HMAC signature', required: false })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, any>,
    @Headers('x-zid-signature') signature?: string,
    @Headers('x-zid-delivery-id') deliveryId?: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const startTime = Date.now();

    // ═══════════════════════════════════════════════════════════════════════════
    // 📌 استخراج البيانات الأساسية من payload زد الخام
    // ═══════════════════════════════════════════════════════════════════════════
    const storeId = body.store_id != null ? String(body.store_id) : undefined;
    const detectedEvent = this.detectEventType(body);

    this.logger.log(`📥 Zid webhook received → detected: ${detectedEvent}`, {
      storeId,
      orderId: body.id,
      orderStatus: body.order_status,
      deliveryId,
      bodyKeys: Object.keys(body).slice(0, 10),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ التحقق: على الأقل لازم يكون فيه store_id
    // ═══════════════════════════════════════════════════════════════════════════
    if (!storeId) {
      this.logger.warn('❌ Zid webhook rejected: missing store_id', {
        bodyKeys: Object.keys(body),
      });
      return { success: false, message: 'Missing store_id' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔐 التحقق من التوقيع (اختياري — زد لا يرسل توقيعات HMAC)
    // ⚠️ Zid does NOT send HMAC signatures unlike Salla/Shopify.
    // Primary security is provided by WebhookIpGuard (IP allowlisting).
    // We only verify a signature if BOTH secret is configured AND Zid sends one
    // (future-proofing in case Zid adds signature support).
    // ═══════════════════════════════════════════════════════════════════════════
    if (this.webhookSecret && signature) {
      const signatureValid = this.verifySignature(req.rawBody, signature);
      if (!signatureValid) {
        this.logger.warn(`⚠️ Zid signature verification failed for ${detectedEvent}`);
        // Don't reject — Zid doesn't officially support signatures yet
      } else {
        this.logger.log(`✅ Zid signature verified for ${detectedEvent}`);
      }
    } else {
      // Expected path for Zid webhooks — no signature (documented platform behavior)
      this.logger.debug(`📝 Zid webhook ${detectedEvent} — no signature (expected for Zid platform)`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔁 التحقق من التكرار
    // ═══════════════════════════════════════════════════════════════════════════
    const idempotencyKey = this.generateIdempotencyKey(body, detectedEvent);
    const isDuplicate = await this.webhooksService.checkDuplicate(idempotencyKey);

    if (isDuplicate) {
      this.logger.log(`⏭️ Duplicate Zid webhook skipped: ${detectedEvent}`);
      return { success: true, message: 'Duplicate webhook - already processed' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 📤 إضافة للـ Queue — نرسل الـ body الكامل كـ data
    // ═══════════════════════════════════════════════════════════════════════════
    const jobData: ZidWebhookJobDto = {
      eventType: detectedEvent,
      storeId,
      data: body,  // ✅ كل بيانات الطلب/العميل كما جاءت من زد
      triggeredAt: (body.updated_at as string) || (body.created_at as string) || new Date().toISOString(),
      deliveryId: deliveryId || `zid_${Date.now()}_${body.id || 'unknown'}`,
      idempotencyKey,
      signature,
      headers: this.extractHeaders(req),
      ipAddress: this.getClientIp(req),
    };

    const jobId = await this.webhooksService.queueWebhook(jobData);

    this.logger.log(`✅ Zid webhook queued: ${detectedEvent}`, {
      jobId,
      orderId: body.id,
      orderStatus: body.order_status,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true, message: 'Webhook received', jobId };
  }

  /**
   * 🔍 اكتشاف نوع الحدث من بنية البيانات
   *
   * زد لا يرسل "event" — نكتشفه من الحقول الموجودة:
   * - order_status موجود → حدث طلب
   * - customer بدون order_status → حدث عميل
   * - products بدون order_status → حدث منتج
   */
  private detectEventType(body: Record<string, any>): string {
    // ── طلب (Order) ──
    // إذا فيه order_status أو invoice_number أو order_total → هذا طلب
    if (body.order_status !== undefined || body.invoice_number !== undefined || body.order_total !== undefined) {
      // نحاول نعرف إذا طلب جديد أو تحديث حالة
      // إذا فيه histories (سجل تغييرات) بأكثر من عنصر → تحديث
      const histories = body.histories;
      if (Array.isArray(histories) && histories.length > 1) {
        return 'order.status.update';
      }
      // إذا الحالة "new" أو "pending" أو "جديد" → طلب جديد
      const status = typeof body.order_status === 'string' ? body.order_status.toLowerCase() : '';
      if (status === 'new' || status === 'pending' || status === 'جديد') {
        return 'order.create';
      }
      // Default: تحديث حالة (الأغلب)
      return 'order.status.update';
    }

    // ── عميل (Customer) ──
    if (body.mobile !== undefined && body.email !== undefined && !body.order_status) {
      return body.created_at === body.updated_at ? 'customer.create' : 'customer.update';
    }

    // ── منتج (Product) ──
    if (body.sku !== undefined || (body.name !== undefined && body.price !== undefined && !body.order_status)) {
      return 'product.update';
    }

    // ── Default ──
    this.logger.warn('⚠️ Could not detect Zid event type from payload', {
      keys: Object.keys(body).slice(0, 15),
    });
    return 'unknown';
  }

  /**
   * 🔐 التحقق من التوقيع
   */
  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!this.webhookSecret) return false;
    if (!signature) {
      this.logger.warn('❌ No signature provided in Zid request');
      return false;
    }
    if (!rawBody) {
      this.logger.warn('❌ No raw body available');
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');

      const cleanSignature = signature.replace(/^sha256=/, '');

      if (cleanSignature.length !== expectedSignature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(cleanSignature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error('Zid signature verification error:', error);
      return false;
    }
  }

  private generateIdempotencyKey(body: Record<string, any>, eventType: string): string {
    const orderId = body.id || '';
    const status = body.order_status || '';
    const storeId = body.store_id || '';
    const updatedAt = body.updated_at || '';
    const data = `zid_${eventType}_${storeId}_${orderId}_${status}_${updatedAt}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private extractHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    const allowedHeaders = ['x-zid-signature', 'x-zid-delivery-id', 'content-type', 'user-agent'];

    for (const key of allowedHeaders) {
      const value = req.headers[key];
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }

    return headers;
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || '0.0.0.0';
  }
}
