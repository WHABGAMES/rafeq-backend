/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhooks Controller                        ║
 * ║                                                                                ║
 * ║  ✅ v1: Production-ready                                                       ║
 * ║  🔐 HMAC-SHA256 signature verification                                        ║
 * ║  🔒 Rejects invalid signatures in production                                  ║
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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

import { ZidWebhooksService } from './zid-webhooks.service';
import { ZidWebhookDto, ZidWebhookJobDto } from './dto/zid-webhook.dto';

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
   * بدون هذا الـ handler، الطلب يُلتقط من WebhooksController@Get(':id')
   * اللي عليه JwtAuthGuard → يرجع 401 → زد يعتبر الرابط معطل
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
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Zid webhooks' })
  @ApiHeader({ name: 'x-zid-signature', description: 'HMAC signature' })
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: false,           // ← لا نحذف الحقول الزائدة
    forbidNonWhitelisted: false, // ← لا نرفض الحقول الزائدة (زد يرسل حقول كثيرة)
    transformOptions: { enableImplicitConversion: true },
  }))
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: ZidWebhookDto,
    @Headers('x-zid-signature') signature?: string,
    @Headers('x-zid-delivery-id') deliveryId?: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const startTime = Date.now();

    this.logger.log(`📥 Zid webhook received: ${payload.event}`, {
      storeId: payload.store_id,
      deliveryId,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔐 التحقق من التوقيع
    // ═══════════════════════════════════════════════════════════════════════════
    if (this.webhookSecret) {
      const signatureValid = this.verifySignature(req.rawBody, signature);

      if (!signatureValid) {
        if (this.isProduction) {
          this.logger.error(`🚨 REJECTED: Invalid Zid signature for ${payload.event}`);
          throw new ForbiddenException('Invalid webhook signature');
        } else {
          this.logger.warn(`⚠️ [DEV] Invalid Zid signature for ${payload.event} — continuing`);
        }
      }
    }

    // التحقق من التكرار
    const idempotencyKey = this.generateIdempotencyKey(payload);
    const isDuplicate = await this.webhooksService.checkDuplicate(idempotencyKey);

    if (isDuplicate) {
      this.logger.log(`⏭️ Duplicate Zid webhook skipped: ${payload.event}`);
      return { success: true, message: 'Duplicate webhook - already processed' };
    }

    // زد يرسل البيانات في payload أو data
    const eventData = payload.payload || payload.data || {};

    // إضافة للـ Queue
    const jobData: ZidWebhookJobDto = {
      eventType: payload.event,
      storeId: payload.store_id,
      data: eventData,
      triggeredAt: payload.triggered_at || new Date().toISOString(),
      deliveryId: deliveryId || `zid_delivery_${Date.now()}`,
      idempotencyKey,
      signature,
      headers: this.extractHeaders(req),
      ipAddress: this.getClientIp(req),
    };

    const jobId = await this.webhooksService.queueWebhook(jobData);

    this.logger.log(`✅ Zid webhook queued: ${payload.event}`, {
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

  private generateIdempotencyKey(payload: ZidWebhookDto): string {
    const data = `zid_${payload.event}_${payload.store_id}_${payload.triggered_at || ''}_${JSON.stringify(payload.payload || payload.data || {}).slice(0, 100)}`;
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
