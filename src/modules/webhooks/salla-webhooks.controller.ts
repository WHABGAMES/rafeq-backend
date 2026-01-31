/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  ✅ يستقبل جميع webhooks من سلة                                               ║
 * ║  ✅ يدعم app.store.authorize (النمط السهل)                                    ║
 * ║  ✅ يدعم جميع أحداث المتجر (orders, customers, etc)                          ║
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
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// Services
import { SallaWebhooksService } from './salla-webhooks.service';
import { SallaOAuthService, SallaAppAuthorizeData } from '../stores/salla-oauth.service';

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

interface SallaWebhookPayload {
  event: string;
  merchant: number;
  created_at: string;
  data: Record<string, any>;
}

interface WebhookHeaders {
  'x-salla-signature'?: string;
  'x-salla-timestamp'?: string;
  'content-type'?: string;
}

@Controller('webhooks/salla')
export class SallaWebhooksController {
  private readonly logger = new Logger(SallaWebhooksController.name);

  constructor(
    private readonly webhooksService: SallaWebhooksService,
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * ✅ POST /api/webhooks/salla
   * نقطة استقبال جميع webhooks من سلة
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: SallaWebhookPayload,
    @Headers() headers: WebhookHeaders,
  ): Promise<{ success: boolean; message: string }> {
    const startTime = Date.now();
    const { event, merchant } = payload;

    this.logger.log(`📨 Received Salla webhook: ${event}`, {
      merchant,
      hasSignature: !!headers['x-salla-signature'],
    });

    try {
      // 1. التحقق من التوقيع (اختياري في التطوير)
      const signatureValid = this.verifySignature(payload, headers);
      
      if (!signatureValid) {
        this.logger.warn(`⚠️ Invalid Salla webhook signature for ${event}`);
        // نستمر حتى لو التوقيع خاطئ (للتطوير)
        // في الإنتاج: throw new BadRequestException('Invalid signature');
      }

      // 2. معالجة الحدث حسب نوعه
      let result: { success: boolean; message: string };

      if (this.isAppEvent(event)) {
        // ✅ أحداث التطبيق (النمط السهل)
        result = await this.handleAppEvent(payload);
      } else {
        // ✅ أحداث المتجر (orders, customers, etc)
        result = await this.handleStoreEvent(payload, headers, signatureValid);
      }

      this.logger.log(`✅ Webhook processed: ${event}`, {
        duration: `${Date.now() - startTime}ms`,
        result: result.message,
      });

      return result;

    } catch (error) {
      this.logger.error(`❌ Webhook processing failed: ${event}`, {
        error: error instanceof Error ? error.message : 'Unknown',
        merchant,
      });

      // نرجع 200 حتى لا تعيد سلة إرسال الـ webhook
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Processing failed',
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ معالجة أحداث التطبيق (النمط السهل)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleAppEvent(
    payload: SallaWebhookPayload,
  ): Promise<{ success: boolean; message: string }> {
    const { event, merchant, data, created_at } = payload;

    this.logger.log(`📱 Processing app event: ${event}`, { merchant });

    switch (event) {
      // ✅ أهم حدث - ربط المتجر
      case 'app.store.authorize': {
        const authorizeData = data as SallaAppAuthorizeData;
        
        const store = await this.sallaOAuthService.handleAppStoreAuthorize(
          merchant,
          authorizeData,
          created_at,
        );

        return {
          success: true,
          message: `Store ${store.id} authorized successfully`,
        };
      }

      // ✅ تثبيت التطبيق
      case 'app.installed': {
        this.logger.log(`📦 App installed for merchant ${merchant}`, {
          appName: data.app_name,
          storeType: data.store_type,
        });
        
        return {
          success: true,
          message: `App installed for merchant ${merchant}`,
        };
      }

      // ✅ إلغاء تثبيت التطبيق
      case 'app.uninstalled': {
        await this.sallaOAuthService.handleAppUninstalled(merchant);
        
        return {
          success: true,
          message: `App uninstalled for merchant ${merchant}`,
        };
      }

      // ✅ أحداث الاشتراك
      case 'app.subscription.started':
      case 'app.subscription.renewed':
      case 'app.subscription.canceled':
      case 'app.subscription.expired':
      case 'app.trial.started':
      case 'app.trial.expired':
      case 'app.trial.canceled': {
        this.logger.log(`💳 Subscription event: ${event}`, {
          merchant,
          planName: data.plan_name,
        });
        
        // TODO: معالجة الاشتراكات
        return {
          success: true,
          message: `Subscription event ${event} received`,
        };
      }

      // ✅ تقييم التطبيق
      case 'app.feedback.created': {
        this.logger.log(`⭐ App feedback received`, {
          merchant,
          rating: data.rating,
        });
        
        return {
          success: true,
          message: `Feedback received with rating ${data.rating}`,
        };
      }

      // ✅ تحديث إعدادات التطبيق
      case 'app.settings.updated': {
        this.logger.log(`⚙️ App settings updated`, {
          merchant,
          settings: data.settings,
        });
        
        return {
          success: true,
          message: 'Settings updated',
        };
      }

      default:
        this.logger.warn(`Unknown app event: ${event}`);
        return {
          success: true,
          message: `Unknown app event: ${event}`,
        };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ معالجة أحداث المتجر (orders, customers, etc)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleStoreEvent(
    payload: SallaWebhookPayload,
    headers: WebhookHeaders,
    signatureValid: boolean,
  ): Promise<{ success: boolean; message: string }> {
    const { event, merchant, data, created_at } = payload;

    // التحقق من التكرار
    const idempotencyKey = this.generateIdempotencyKey(payload);
    const isDuplicate = await this.webhooksService.checkDuplicate(idempotencyKey);

    if (isDuplicate) {
      this.logger.warn(`Duplicate webhook detected: ${event}`, { idempotencyKey });
      return { success: true, message: 'Duplicate webhook ignored' };
    }

    // إضافة للـ queue للمعالجة
    const jobId = await this.webhooksService.queueWebhook({
      eventType: event,
      merchant,
      data,
      deliveryId: headers['x-salla-timestamp'] || Date.now().toString(),
      idempotencyKey,
      signature: headers['x-salla-signature'],
      headers: headers as Record<string, string>,
      ipAddress: '0.0.0.0', // Will be set by middleware
    });

    return {
      success: true,
      message: `Webhook queued with job ID: ${jobId}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من توقيع Webhook
   */
  private verifySignature(
    payload: SallaWebhookPayload,
    headers: WebhookHeaders,
  ): boolean {
    const signature = headers['x-salla-signature'];
    
    if (!signature) {
      this.logger.warn('No signature provided');
      return false;
    }

    const secret = this.configService.get<string>('SALLA_WEBHOOK_SECRET');
    
    if (!secret) {
      this.logger.warn('SALLA_WEBHOOK_SECRET not configured');
      return false;
    }

    try {
      const payloadString = JSON.stringify(payload);
      const computedSignature = crypto
        .createHmac('sha256', secret)
        .update(payloadString)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(computedSignature),
      );

      if (!isValid) {
        this.logger.warn('Signature mismatch', {
          received: signature.substring(0, 20) + '...',
          computed: computedSignature.substring(0, 20) + '...',
        });
      }

      return isValid;

    } catch (error) {
      this.logger.error('Signature verification error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return false;
    }
  }

  /**
   * التحقق مما إذا كان الحدث من نوع App Event
   */
  private isAppEvent(event: string): boolean {
    return event.startsWith('app.');
  }

  /**
   * توليد مفتاح فريد للتحقق من التكرار
   */
  private generateIdempotencyKey(payload: SallaWebhookPayload): string {
    const { event, merchant, created_at, data } = payload;
    const dataId = data.id || data.order_id || data.customer_id || '';
    
    return crypto
      .createHash('sha256')
      .update(`${event}:${merchant}:${created_at}:${dataId}`)
      .digest('hex');
  }
}
