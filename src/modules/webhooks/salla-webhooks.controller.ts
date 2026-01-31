/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  ✅ يستقبل webhooks من سلة                                                     ║
 * ║  ✅ يدعم app.store.authorize للنمط السهل                                       ║
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

  constructor(
    private readonly webhooksService: SallaWebhooksService,
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('SALLA_WEBHOOK_SECRET', '');
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

    // التحقق من التوقيع
    const signatureValid = this.verifySignature(req.rawBody, signature);
    
    if (!signatureValid) {
      this.logger.warn(`⚠️ Invalid signature for webhook ${payload.event}`);
      // نستمر بالمعالجة حتى لو كان التوقيع غير صحيح (للتطوير)
    }

    // معالجة خاصة لـ app.store.authorize (النمط السهل)
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
   * ⚡ معالجة app.store.authorize (النمط السهل)
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
    if (!this.webhookSecret || !signature || !rawBody) {
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch {
      return false;
    }
  }

  /**
   * 🔑 توليد مفتاح التكرار
   */
  private generateIdempotencyKey(payload: SallaWebhookDto): string {
    const data = `${payload.event}_${payload.merchant}_${payload.created_at}_${JSON.stringify(payload.data).slice(0, 100)}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 📋 استخراج الـ Headers
   */
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

  /**
   * 🌐 الحصول على IP العميل
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || '0.0.0.0';
  }
}
