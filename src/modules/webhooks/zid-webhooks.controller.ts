/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhooks Controller                        ║
 * ║                                                                                ║
 * ║  ✅ v4: Security Model - IP Validation (Zid Platform Standard)                ║
 * ║  زد لا يرسل "event" — يرسل بيانات الطلب/العميل مباشرة                         ║
 * ║  الـ Controller يكتشف نوع الحدث من بنية البيانات                               ║
 * ║                                                                                ║
 * ║  🔧 FIX: generateIdempotencyKey يستخدم deliveryId لأحداث App Market           ║
 * ║  deliveryId = فريد لكل إرسال من زد → لا تكرار مهما أُعيد التثبيت/الإلغاء     ║
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
import { EventEmitter2 } from '@nestjs/event-emitter';

@ApiTags('Webhooks - Zid')
@Controller('webhooks/zid')
@UseGuards(WebhookIpGuard) // ✅ IP allowlist - primary security layer for Zid
export class ZidWebhooksController {
  private readonly logger = new Logger(ZidWebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly webhooksService: ZidWebhooksService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
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
    const resolvedDeliveryId = deliveryId || `zid_${Date.now()}_${body.store_id || body.id || 'unknown'}`;
    const idempotencyKey = this.generateIdempotencyKey(body, detectedEvent, resolvedDeliveryId);
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
      deliveryId: resolvedDeliveryId,
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

    this.eventEmitter.emit('audit.webhook.received', {
      platform: 'zid',
      event: detectedEvent,
      merchantId: body.store_id,
      durationMs: Date.now() - startTime,
    });

    return { success: true, message: 'Webhook received', jobId };
  }


  /**
   * 🔍 اكتشاف نوع الحدث من بنية البيانات — متوافق مع وثائق Zid الرسمية
   *
   * ترتيب الكشف (من الأكثر تحديداً للأقل):
   *
   * 0. App Market events   → تحتوي على event_name (وثائق Zid: Events section)
   * 1. order.payment_status.update → payment_status_change field
   * 2. abandoned_cart.*    → cart_total + phase/url/reminders_count fields
   * 3. order.*             → order_status / invoice_number / order_total fields
   * 4. customer.*          → email + mobile/telephone بدون حقول الطلبات
   * 5. category.*          → sub_categories / flat_name بدون sku أو email
   * 6. product.*           → sku / name+price بدون order أو customer fields
   *
   * مصادر: Zid API Docs - Webhook Events + Payload Schemas
   */
  private detectEventType(body: Record<string, any>): string {

    // ══════════════════════════════════════════════════════════════════
    // 0. App Market events — تُرسل مع event_name (12 حدث رسمي من زد)
    //    app.market.application.install / uninstall / authorized / rated
    //    app.market.subscription.active / renew / upgrade / suspended /
    //                              expired / refunded / warning
    //    app.market.private.plan.request
    // ══════════════════════════════════════════════════════════════════
    if (body.event_name && typeof body.event_name === 'string') {
      const eventName = body.event_name.trim();
      this.logger.log(`🏪 App Market event detected via event_name: ${eventName}`);
      return eventName;
    }

    // ══════════════════════════════════════════════════════════════════
    // 1. order.payment_status.update
    //    وثائق Zid: "Triggered when an order's payment status changes to paid or unpaid"
    //    يُرسل حقل payment_status_change مع old/new values
    // ══════════════════════════════════════════════════════════════════
    if (body.payment_status_change !== undefined) {
      return 'order.payment_status.update';
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. abandoned_cart.created / abandoned_cart.completed
    //    وثائق Zid: AbandonedCart schema:
    //    cart_total, cart_total_string, phase, url, reminders_count,
    //    customer_id, customer_name, customer_email, customer_mobile
    //
    //    phase === 'completed' → abandoned_cart.completed
    //    أي phase أخرى (new, login, shipping_address, ...) → abandoned_cart.created
    // ══════════════════════════════════════════════════════════════════
    const isAbandonedCart = (
      body.cart_total !== undefined &&
      body.order_status === undefined &&
      body.invoice_number === undefined &&
      (body.phase !== undefined || body.url !== undefined || body.reminders_count !== undefined)
    );
    if (isAbandonedCart) {
      return body.phase === 'completed' ? 'abandoned_cart.completed' : 'abandoned_cart.created';
    }

    // ══════════════════════════════════════════════════════════════════
    // 3. Order events — وثائق Zid: Order schema
    //    order.create, order.status.update, order.payment_status.update
    //    الحقول المميّزة: order_status, invoice_number, order_total
    // ══════════════════════════════════════════════════════════════════
    if (
      body.order_status !== undefined ||
      body.invoice_number !== undefined ||
      body.order_total !== undefined
    ) {
      // histories.length > 1 → حدثت تغييرات سابقة → order.status.update
      const histories = body.histories;
      if (Array.isArray(histories) && histories.length > 1) {
        return 'order.status.update';
      }
      // استخراج كود الحالة — زد يُرسله كـ object { code, name } أو string
      const orderStatus = body.order_status;
      const statusCode = (
        typeof orderStatus === 'object' && orderStatus !== null
          ? (orderStatus.code || orderStatus.slug || '')
          : (typeof orderStatus === 'string' ? orderStatus : '')
      ).toLowerCase();

      // 'new' أو 'جديد' → طلب جديد
      if (statusCode === 'new' || statusCode === 'جديد') {
        return 'order.create';
      }

      // الافتراضي: تحديث حالة الطلب
      return 'order.status.update';
    }

    // ══════════════════════════════════════════════════════════════════
    // 4. Customer events — وثائق Zid: Customer schema
    //    customer.create, customer.update, customer.login,
    //    customer.merchant.update
    //
    //    الحقول المميّزة: email + (mobile أو telephone)
    //    customer.login: is_active + لا توجد تغييرات على البيانات
    //    customer.merchant.update: يحتوي على حقل merchant أو meta خاص
    // ══════════════════════════════════════════════════════════════════
    const isCustomerPayload = (
      body.email !== undefined &&
      (body.mobile !== undefined || body.telephone !== undefined) &&
      body.order_status === undefined &&
      body.invoice_number === undefined &&
      body.cart_total === undefined &&
      body.sku === undefined
    );
    if (isCustomerPayload) {
      // customer.merchant.update: يحتوي على حقول تاجر/بيانات تجارية
      if (body.business_name !== undefined || body.tax_number !== undefined || body.commercial_registration !== undefined) {
        return 'customer.merchant.update';
      }
      // customer.login: لا تغيير في البيانات، created_at قديم، updated_at حديث جداً
      // زد يُرسل نفس Customer schema — نستخدم is_active كمؤشر
      // إذا created_at !== updated_at ولا يوجد تغيير واضح → customer.login
      if (body.is_active !== undefined && body.created_at !== undefined && body.updated_at !== undefined) {
        // إذا كانت الحسابات مختلفة وهناك is_active فقط → login
        const createdAt = new Date(body.created_at).getTime();
        const updatedAt = new Date(body.updated_at).getTime();
        // تسجيل دخول: الفرق بين created_at و updated_at كبير جداً (حساب قديم)
        if (!isNaN(createdAt) && !isNaN(updatedAt) && (updatedAt - createdAt) > 86400000 /* 24h */) {
          // ملاحظة: customer.login يُرسل نفس payload Customer
          // نعتمد على is_active + عدم وجود تغيير في البيانات الأساسية
          if (body.name !== undefined && body.gender === undefined) {
            return 'customer.login';
          }
        }
      }
      // customer.create: الحساب جديد (created_at === updated_at أو قريبان)
      if (body.created_at !== undefined && body.updated_at !== undefined) {
        return body.created_at === body.updated_at ? 'customer.create' : 'customer.update';
      }
      return 'customer.create';
    }

    // ══════════════════════════════════════════════════════════════════
    // 5. Category events — وثائق Zid: ProductCategory schema
    //    category.create, category.update, category.delete
    //    الحقول المميّزة: sub_categories أو flat_name أو slug
    //    بدون: sku، order_status، email، telephone، cart_total
    // ══════════════════════════════════════════════════════════════════
    const isCategoryPayload = (
      (body.sub_categories !== undefined || body.flat_name !== undefined) &&
      body.sku === undefined &&
      body.order_status === undefined &&
      body.email === undefined &&
      body.cart_total === undefined
    );
    if (isCategoryPayload) {
      // category.delete: is_published === false مع deleted_at أو عدم وجود products
      if (body.is_published === false && (body.deleted_at !== undefined || body.products_count === 0)) {
        return 'category.delete';
      }
      // category.create: created_at === updated_at
      if (body.created_at !== undefined && body.updated_at !== undefined) {
        return body.created_at === body.updated_at ? 'category.create' : 'category.update';
      }
      return 'category.update';
    }

    // ══════════════════════════════════════════════════════════════════
    // 6. Product events — وثائق Zid: Product schema
    //    product.create, product.update, product.publish, product.delete
    //    الحقول المميّزة: sku / name+price+is_published
    // ══════════════════════════════════════════════════════════════════
    const isProductPayload = (
      body.sku !== undefined ||
      (
        body.name !== undefined &&
        body.price !== undefined &&
        body.order_status === undefined &&
        body.email === undefined &&
        body.cart_total === undefined
      )
    );
    if (isProductPayload) {
      // product.delete: يحتوي على deleted أو is_published: false مع deleted_at
      if (body.deleted !== undefined && body.deleted !== null) {
        return 'product.delete';
      }
      // product.publish: is_published تغيّر إلى true
      if (body.is_published === true && body.is_draft === false) {
        // إذا created_at !== updated_at → تم النشر من draft
        if (body.created_at !== undefined && body.updated_at !== undefined && body.created_at !== body.updated_at) {
          return 'product.publish';
        }
      }
      // product.create: created_at === updated_at (منتج جديد)
      if (body.created_at !== undefined && body.updated_at !== undefined) {
        return body.created_at === body.updated_at ? 'product.create' : 'product.update';
      }
      return 'product.update';
    }

    // ══════════════════════════════════════════════════════════════════
    // Default: لم يُتعرّف على الحدث
    // ══════════════════════════════════════════════════════════════════
    this.logger.warn('⚠️ Could not detect Zid event type from payload', {
      keys: Object.keys(body).slice(0, 15),
      storeId: body.store_id,
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

  /**
   * ✅ FIX: توليد idempotencyKey آمن لجميع أنواع أحداث زد
   *
   * المشكلة القديمة (App Market events):
   *   hash = zid + event_name + store_id + status + start_date
   *   → نفس المتجر يُلغي ويُثبّت ويُلغي مجدداً في نفس فترة الاشتراك
   *   → نفس الـ hash → يُعتبر duplicate → يُحجب إلى الأبد
   *   + UNIQUE INDEX في DB → 500 Error لو حاول يُدرج مرة ثانية
   *
   * الحل الجذري — deliveryId-based لأحداث App Market:
   *   deliveryId = x-zid-delivery-id header (فريد لكل إرسال HTTP من زد)
   *   fallback = zid_ + timestamp (فريد بطبيعته)
   *   → كل delivery من زد = hash فريد = لا تكرار أبداً
   *   → Zid retry لنفس الـ delivery: نفس deliveryId → محجوب بشكل صحيح ✅
   *   → إلغاء جديد بعد إعادة التثبيت: deliveryId جديد → يُعالَج ✅
   *   → لا UNIQUE constraint violation في DB ✅
   *
   * Regular events (orders/customers) → content-based hash (لم يتغير)
   *   → يمنع معالجة نفس تحديث الطلب مرتين إذا أعاد زد الإرسال بنفس البيانات ✅
   */
  private generateIdempotencyKey(body: Record<string, any>, eventType: string, deliveryId: string): string {
    // App Market events → deliveryId-based (فريد لكل إرسال من زد)
    if (body.event_name) {
      const data = `zid_${body.event_name}_${body.store_id || ''}_${deliveryId}`;
      return crypto.createHash('sha256').update(data).digest('hex');
    }
    // Merchant events (orders/customers/products) → content-based hash
    const orderId = body.id || '';
    const status = typeof body.order_status === 'object' && body.order_status !== null
      ? (body.order_status.code || body.order_status.slug || '')
      : (body.order_status || '');
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
