/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhooks Controller                        ║
 * ║                                                                                ║
 * ║  ✅ v2: Fix 400 — bypass global ValidationPipe                                 ║
 * ║  🔐 HMAC-SHA256 signature verification                                        ║
 * ║  🔒 Rejects invalid signatures in production                                  ║
 * ║                                                                                ║
 * ║  ⚠️  لماذا لا نستخدم DTO class مع @Body()؟                                    ║
 * ║  لأن main.ts فيها global ValidationPipe مع forbidNonWhitelisted: true          ║
 * ║  وزد يرسل حقول كثيرة (conditions, subscriber, message, etc.)                  ║
 * ║  الـ global pipe يعمل قبل @UsePipes ولا يمكن تجاوزه                            ║
 * ║  الحل: نستقبل body كـ Record<string, any> ونتحقق يدوياً                       ║
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
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

import { ZidWebhooksService } from './zid-webhooks.service';
import { ZidWebhookJobDto } from './dto/zid-webhook.dto';

@ApiTags('Webhooks - Zid')
@Controller('webhooks/zid')
export class ZidWebhooksController {
  private readonly logger = new Logger(ZidWebhooksController.name);
  private readonly webhookSecret: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly webhooksService: ZidWebhooksService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('ZID_WEBHOOK_SECRET') ||
      this.configService.get<string>('zid.webhookSecret') ||
      '';

    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    if (this.webhookSecret) {
      this.logger.log(`✅ Zid webhook secret loaded (length: ${this.webhookSecret.length})`);
    } else {
      this.logger.warn('⚠️ ZID_WEBHOOK_SECRET is not configured — signature verification disabled');
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
   * ⚠️ نستخدم Record<string, any> بدل ZidWebhookDto عشان:
   *    - Global ValidationPipe (forbidNonWhitelisted: true) يرفض الحقول الزائدة
   *    - @UsePipes لا يتجاوز الـ global pipe (يعملون بالتسلسل)
   *    - زد يرسل حقول كثيرة غير معروفة مسبقاً
   *    - نتحقق يدوياً من الحقول المطلوبة فقط (event, store_id)
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Zid webhooks' })
  @ApiHeader({ name: 'x-zid-signature', description: 'HMAC signature' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, any>,
    @Headers('x-zid-signature') signature?: string,
    @Headers('x-zid-delivery-id') deliveryId?: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const startTime = Date.now();

    // ═══════════════════════════════════════════════════════════════════════════
    // 📥 استخراج الحقول الأساسية من الـ body
    // ═══════════════════════════════════════════════════════════════════════════
    const event = body?.event;
    const storeId = body?.store_id != null ? String(body.store_id) : undefined;

    // ✅ التحقق اليدوي من الحقول المطلوبة
    if (!event || typeof event !== 'string') {
      this.logger.warn('❌ Zid webhook rejected: missing or invalid "event" field', {
        bodyKeys: Object.keys(body || {}),
        event,
      });
      throw new BadRequestException('Missing required field: event');
    }

    if (!storeId) {
      this.logger.warn('❌ Zid webhook rejected: missing "store_id" field', {
        bodyKeys: Object.keys(body || {}),
      });
      throw new BadRequestException('Missing required field: store_id');
    }

    this.logger.log(`📥 Zid webhook received: ${event}`, {
      storeId,
      deliveryId,
      bodyKeys: Object.keys(body),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔐 التحقق من التوقيع
    // ═══════════════════════════════════════════════════════════════════════════
    if (this.webhookSecret) {
      const signatureValid = this.verifySignature(req.rawBody, signature);

      if (!signatureValid) {
        if (this.isProduction) {
          this.logger.error(`🚨 REJECTED: Invalid Zid signature for ${event}`);
          throw new ForbiddenException('Invalid webhook signature');
        } else {
          this.logger.warn(`⚠️ [DEV] Invalid Zid signature for ${event} — continuing`);
        }
      }
    }

    // التحقق من التكرار
    const triggeredAt = body.triggered_at || '';
    const idempotencyKey = this.generateIdempotencyKey(event, storeId, triggeredAt, body);
    const isDuplicate = await this.webhooksService.checkDuplicate(idempotencyKey);

    if (isDuplicate) {
      this.logger.log(`⏭️ Duplicate Zid webhook skipped: ${event}`);
      return { success: true, message: 'Duplicate webhook - already processed' };
    }

    // زد يرسل البيانات في payload أو data
    const eventData = body.payload || body.data || {};

    // إضافة للـ Queue
    const jobData: ZidWebhookJobDto = {
      eventType: event,
      storeId,
      data: eventData,
      triggeredAt: triggeredAt || new Date().toISOString(),
      deliveryId: deliveryId || `zid_delivery_${Date.now()}`,
      idempotencyKey,
      signature,
      headers: this.extractHeaders(req),
      ipAddress: this.getClientIp(req),
    };

    const jobId = await this.webhooksService.queueWebhook(jobData);

    this.logger.log(`✅ Zid webhook queued: ${event}`, {
      jobId,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true, message: 'Webhook received', jobId };
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

  private generateIdempotencyKey(
    event: string,
    storeId: string,
    triggeredAt: string,
    body: Record<string, any>,
  ): string {
    const data = `zid_${event}_${storeId}_${triggeredAt}_${JSON.stringify(body.payload || body.data || {}).slice(0, 100)}`;
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
