/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  ✅ v5: Security Fixes                                                         ║
 * ║  🔧 FIX C1: رفض الطلبات بتوقيع غير صالح في الإنتاج                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

import { SallaWebhooksService } from './salla-webhooks.service';
import { SallaOAuthService, SallaAppAuthorizeData } from '../stores/salla-oauth.service';
import { SallaWebhookDto, SallaWebhookJobDto } from './dto/salla-webhook.dto';

@ApiTags('Webhooks - Salla')
@Controller('webhooks/salla')
export class SallaWebhooksController {
  private readonly logger = new Logger(SallaWebhooksController.name);
  private readonly webhookSecret: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly webhooksService: SallaWebhooksService,
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('SALLA_WEBHOOK_SECRET') ||
      this.configService.get<string>('salla.webhookSecret') ||
      '';

    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    if (this.webhookSecret) {
      this.logger.log(`✅ Salla webhook secret loaded (length: ${this.webhookSecret.length})`);
    } else {
      // 🔧 FIX C1: تحذير شديد إذا لم يكن هناك secret
      this.logger.error('🚨 SALLA_WEBHOOK_SECRET is not configured! Webhooks cannot be verified.');
    }
  }

  /**
   * 🔔 استقبال Webhooks من سلة
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Salla webhooks' })
  @ApiHeader({ name: 'x-salla-signature', description: 'HMAC signature' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: SallaWebhookDto,
    @Headers('x-salla-signature') signature?: string,
    @Headers('x-salla-delivery') deliveryId?: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const startTime = Date.now();

    this.logger.log(`📥 Webhook received: ${payload.event}`, {
      merchant: payload.merchant,
      deliveryId,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX C1: رفض الطلبات بتوقيع غير صالح في الإنتاج
    // في بيئة التطوير: تحذير فقط مع الاستمرار
    // في بيئة الإنتاج: رفض فوري مع 403
    // ═══════════════════════════════════════════════════════════════════════════
    const signatureValid = this.verifySignature(req.rawBody, signature);

    // 🔧 FIX M-05: ALWAYS reject invalid signatures — no dev bypass
    // Invalid signatures are rejected in ALL environments to prevent
    // developers from accidentally relying on unverified webhooks.
    if (!signatureValid) {
      this.logger.error(
        `🚨 REJECTED: Invalid signature for ${payload.event} from merchant ${payload.merchant}`,
      );
      throw new ForbiddenException('Invalid webhook signature');
    }

    // معالجة خاصة لـ app.store.authorize
    if (payload.event === 'app.store.authorize') {
      return this.handleAppStoreAuthorize(payload);
    }

    // معالجة خاصة لـ app.uninstalled
    if (payload.event === 'app.uninstalled') {
      return this.handleAppUninstalled(payload);
    }

    // التحقق من التكرار
    const idempotencyKey = this.generateIdempotencyKey(payload);
    const isDuplicate = await this.webhooksService.checkDuplicate(idempotencyKey);

    if (isDuplicate) {
      this.logger.log(`⏭️ Duplicate webhook skipped: ${payload.event}`);
      return { success: true, message: 'Duplicate webhook - already processed' };
    }

    // إضافة للـ Queue
    const jobData: SallaWebhookJobDto = {
      eventType: payload.event,
      merchant: payload.merchant,
      data: payload.data,
      createdAt: payload.created_at,
      deliveryId: deliveryId || `delivery_${Date.now()}`,
      idempotencyKey,
      signature,
      headers: this.extractHeaders(req),
      ipAddress: this.getClientIp(req),
    };

    const jobId = await this.webhooksService.queueWebhook(jobData);

    this.logger.log(`✅ Webhook queued: ${payload.event}`, {
      jobId,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true, message: 'Webhook received', jobId };
  }

  /**
   * ⚡ معالجة app.store.authorize
   */
  private async handleAppStoreAuthorize(
    payload: SallaWebhookDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`⚡ Processing app.store.authorize for merchant ${payload.merchant}`);

    try {
      const data = payload.data as unknown as SallaAppAuthorizeData;

      await this.sallaOAuthService.handleAppStoreAuthorize(
        payload.merchant,
        data,
        payload.created_at,
      );

      this.logger.log(`✅ app.store.authorize processed for merchant ${payload.merchant}`);

      return { success: true, message: 'Store authorized successfully' };
    } catch (error: any) {
      this.logger.error(`❌ Failed to process app.store.authorize`, error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * 🗑️ معالجة app.uninstalled
   */
  private async handleAppUninstalled(
    payload: SallaWebhookDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`🗑️ Processing app.uninstalled for merchant ${payload.merchant}`);

    try {
      await this.sallaOAuthService.handleAppUninstalled(payload.merchant);

      this.logger.log(`✅ app.uninstalled processed for merchant ${payload.merchant}`);

      return { success: true, message: 'App uninstalled processed' };
    } catch (error: any) {
      this.logger.error(`❌ Failed to process app.uninstalled`, error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * 🔐 التحقق من التوقيع
   */
  private verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('❌ Webhook secret not configured');
      return false;
    }

    if (!signature) {
      this.logger.warn('❌ No signature provided in request');
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

      const cleanSignature = signature.replace(/^sha256=|^sha1=/, '');

      if (cleanSignature.length !== expectedSignature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(cleanSignature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error('Signature verification error:', error);
      return false;
    }
  }

  private generateIdempotencyKey(payload: SallaWebhookDto): string {
    const data = `${payload.event}_${payload.merchant}_${payload.created_at}_${JSON.stringify(payload.data).slice(0, 100)}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private extractHeaders(req: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    const allowedHeaders = ['x-salla-signature', 'x-salla-delivery', 'content-type', 'user-agent'];

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
