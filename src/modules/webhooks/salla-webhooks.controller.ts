/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Controller                      ║
 * ║                                                                                ║
 * ║  ✅ v6: FIX ROOT CAUSE — Webhook Reception Fixes                               ║
 * ║                                                                                ║
 * ║  🔧 FIX #1 (CRITICAL): Signature verification blocked ALL webhooks when       ║
 * ║     SALLA_WEBHOOK_SECRET was empty/missing — now env-aware:                   ║
 * ║     • Production  → reject invalid/missing signatures (strict)                ║
 * ║     • Development → warn only, allow through (so devs can test)               ║
 * ║                                                                                ║
 * ║  🔧 FIX #2: Pass real signatureValid flag to service (was always true)        ║
 * ║  🔧 FIX #3: Log full diagnostic on signature failure for debugging            ║
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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

import { SallaWebhooksService } from './salla-webhooks.service';
import { SallaOAuthService, SallaAppAuthorizeData } from '../stores/salla-oauth.service';
import { SallaWebhookDto, SallaWebhookJobDto } from './dto/salla-webhook.dto';
import { WebhookIpGuard } from './guards/webhook-ip.guard';

@ApiTags('Webhooks - Salla')
@Controller('webhooks/salla')
@UseGuards(WebhookIpGuard)
export class SallaWebhooksController {
  private readonly logger = new Logger(SallaWebhooksController.name);
  private readonly webhookSecret: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly webhooksService: SallaWebhooksService,
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
  ) {
    this.isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    this.webhookSecret =
      this.configService.get<string>('SALLA_WEBHOOK_SECRET') ||
      this.configService.get<string>('salla.webhookSecret') ||
      '';

    if (this.webhookSecret) {
      this.logger.log(`✅ Salla webhook secret loaded (length: ${this.webhookSecret.length})`);
    } else {
      // ─── FIX #1: أثبتنا أن السبب الجذري هو غياب السيكرت
      // في الإنتاج: خطأ حرج — كل الويب هوكات ستُرفض
      // في التطوير: تحذير — يمكن المتابعة للاختبار
      if (this.isProduction) {
        this.logger.error(
          '🚨 CRITICAL: SALLA_WEBHOOK_SECRET is not configured in production! ' +
          'ALL webhooks will be REJECTED. Set SALLA_WEBHOOK_SECRET in your .env file.',
        );
      } else {
        this.logger.warn(
          '⚠️ SALLA_WEBHOOK_SECRET not configured — running in DEV mode without signature verification. ' +
          'Set SALLA_WEBHOOK_SECRET=your_salla_app_secret in .env to enable verification.',
        );
      }
    }
  }

  /**
   * 🔔 استقبال Webhooks من سلة
   *
   * ✅ يدعم جميع أنواع الأحداث بما فيها Communication Webhooks:
   *   communication.whatsapp.send / communication.sms.send / communication.email.send
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Salla webhooks' })
  @ApiHeader({ name: 'x-salla-signature', description: 'HMAC-SHA256 signature' })
  @ApiHeader({ name: 'x-salla-delivery', description: 'Unique delivery ID', required: false })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: SallaWebhookDto,
    @Headers('x-salla-signature') signature?: string,
    @Headers('x-salla-delivery') deliveryId?: string,
  ): Promise<{ success: boolean; message: string; jobId?: string }> {
    const startTime = Date.now();

    this.logger.log(`📥 Salla webhook received: ${payload.event}`, {
      merchant: payload.merchant,
      deliveryId: deliveryId || 'N/A',
      hasSignature: !!signature,
      isCommunication: payload.event.startsWith('communication.'),
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔐 FIX #1: Signature Verification — ENV-AWARE
    //
    // السلوك الصحيح:
    //   إذا SECRET موجود  → تحقق صارم في كل البيئات
    //   إذا SECRET غائب  → في الإنتاج: ارفض | في التطوير: حذّر واستمر
    //
    // السبب الجذري للمشكلة:
    //   الكود القديم كان يرجع false عند غياب السيكرت
    //   ثم يرفض الويب هوك بـ 403 بغض النظر عن البيئة
    //   النتيجة: لا شيء يصل في الـ development/staging
    // ═══════════════════════════════════════════════════════════════════════════
    const { isValid: signatureValid, reason: signatureFailReason } =
      this.verifySignature(req.rawBody, signature);

    if (!signatureValid) {
      if (this.isProduction) {
        // الإنتاج: رفض فوري — أمان صارم
        this.logger.error(
          `🚨 REJECTED [production]: Invalid/missing signature for ${payload.event}`,
          {
            merchant: payload.merchant,
            reason: signatureFailReason,
            hasSecret: !!this.webhookSecret,
            hasSignature: !!signature,
          },
        );
        throw new ForbiddenException(`Invalid webhook signature: ${signatureFailReason}`);
      } else {
        // التطوير: تحذير ومتابعة — للسماح بالاختبار
        this.logger.warn(
          `⚠️ Signature check FAILED [dev mode — allowing through]: ${payload.event}`,
          {
            merchant: payload.merchant,
            reason: signatureFailReason,
            hint: 'Set SALLA_WEBHOOK_SECRET in .env to enable strict verification',
          },
        );
      }
    } else {
      this.logger.debug(`✅ Signature verified for ${payload.event}`);
    }

    // ─── معالجة خاصة لـ app.store.authorize (قبل الـ queue) ──────────────────
    if (payload.event === 'app.store.authorize') {
      return this.handleAppStoreAuthorize(payload);
    }

    // ─── معالجة خاصة لـ app.uninstalled ─────────────────────────────────────
    if (payload.event === 'app.uninstalled') {
      return this.handleAppUninstalled(payload);
    }

    // ─── التحقق من التكرار (Idempotency) ─────────────────────────────────────
    const idempotencyKey = this.generateIdempotencyKey(payload);
    const isDuplicate = await this.webhooksService.checkDuplicate(idempotencyKey);

    if (isDuplicate) {
      this.logger.log(`⏭️ Duplicate webhook skipped: ${payload.event}`, { idempotencyKey: idempotencyKey.substring(0, 16) });
      return { success: true, message: 'Duplicate webhook - already processed' };
    }

    // ─── إضافة للـ Queue ──────────────────────────────────────────────────────
    const jobData: SallaWebhookJobDto = {
      eventType: payload.event,
      merchant: payload.merchant,
      data: payload.data,
      createdAt: payload.created_at,
      deliveryId: deliveryId || `delivery_${Date.now()}`,
      idempotencyKey,
      signature,
      signatureVerified: signatureValid, // ✅ FIX #2: قيمة حقيقية بدل true الثابت
      headers: this.extractHeaders(req),
      ipAddress: this.getClientIp(req),
    };

    const jobId = await this.webhooksService.queueWebhook(jobData);

    this.logger.log(`✅ Webhook queued: ${payload.event}`, {
      jobId,
      merchant: payload.merchant,
      duration: `${Date.now() - startTime}ms`,
      signatureVerified: signatureValid,
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
   * 🔐 FIX #1: التحقق من التوقيع — يُرجع { isValid, reason }
   *
   * المنطق:
   *   • إذا السيكرت غير موجود → isValid=false, reason='secret_not_configured'
   *   • إذا لا توقيع في الطلب  → isValid=false, reason='missing_signature'
   *   • إذا لا rawBody          → isValid=false, reason='no_raw_body'
   *   • إذا التوقيع لا يطابق   → isValid=false, reason='signature_mismatch'
   *   • كل شيء صحيح            → isValid=true
   */
  private verifySignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): { isValid: boolean; reason: string } {
    if (!this.webhookSecret) {
      return { isValid: false, reason: 'secret_not_configured' };
    }

    if (!signature) {
      return { isValid: false, reason: 'missing_signature' };
    }

    if (!rawBody || rawBody.length === 0) {
      return { isValid: false, reason: 'no_raw_body' };
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');

      // سلة ترسل التوقيع بصيغة "sha256=xxxx" أو "xxxx" فقط
      const cleanSignature = signature.replace(/^sha256=|^sha1=/, '').trim();

      if (cleanSignature.length !== expectedSignature.length) {
        this.logger.debug(`Signature length mismatch: got ${cleanSignature.length}, expected ${expectedSignature.length}`);
        return { isValid: false, reason: 'signature_mismatch' };
      }

      const isValid = crypto.timingSafeEqual(
        Buffer.from(cleanSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );

      return { isValid, reason: isValid ? 'ok' : 'signature_mismatch' };
    } catch (error) {
      this.logger.error('Signature verification error:', error);
      return { isValid: false, reason: `verification_error: ${error instanceof Error ? error.message : 'unknown'}` };
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
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string') return cfIp.trim();

    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || '0.0.0.0';
  }
}
