/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Template Dispatcher Service                      ║
 * ║                                                                                ║
 * ║  📌 يستمع لأحداث الـ webhooks ويرسل رسائل واتساب تلقائية                      ║
 * ║                                                                                ║
 * ║  ✅ v5: يقرأ data.customer + data.order.customer + lookup من DB              ║
 * ║  ✅ v18: FIX — إزالة المستمعين المكررين + dedup بالهاتف + إصلاح [object Object] ║
 * ║                                                                                ║
 * ║  المسار:                                                                       ║
 * ║  Webhook → Processor → EventEmitter → هذا الـ Service                          ║
 * ║  → يبحث عن قالب مفعّل بنفس triggerEvent                                       ║
 * ║  → يستبدل المتغيرات → يرسل عبر واتساب                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageTemplate, Order, Customer } from '@database/entities';
import { SendingMode } from '@database/entities/message-template.entity';
import { Channel, ChannelType, ChannelStatus } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import { TemplateSchedulerService } from './template-scheduler.service';
import { SmsService } from '../channels/sms/sms.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class TemplateDispatcherService {
  private readonly logger = new Logger(TemplateDispatcherService.name);

  /**
   * ✅ v12: Dedup cache لمنع إرسال القالب مرتين
   * سلة أحياناً ترسل order.cancelled + order.status.updated(ملغي) معاً
   * كلاهما يُفعّل نفس القالب — الـ dedup يمنع التكرار
   * Key: `${orderId}-${triggerEvent}-${tenantId}` → timestamp
   */
  private readonly recentDispatches = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 60_000; // 60 ثانية

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepository: Repository<MessageTemplate>,

    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,

    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,

    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,

    private readonly channelsService: ChannelsService,

    // ✅ v13: خدمة الجدولة للإرسال المؤجل
    private readonly templateSchedulerService: TemplateSchedulerService,

    // ✅ v19: Communication relay — SMS + Email حقيقي
    private readonly smsService: SmsService,
    private readonly mailService: MailService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Event Listeners
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnEvent('order.created')
  async onOrderCreated(payload: Record<string, unknown>) {
    await this.dispatch('order.created', payload);
  }

  // ✅ v8: حُذف @OnEvent('order.status.updated') العام نهائياً - كل حالة لها listener خاص

  // ✅ v7: Events خاصة بكل حالة طلب - كل حالة ترسل القالب الصحيح
  @OnEvent('order.status.processing')
  async onOrderProcessing(payload: Record<string, unknown>) {
    await this.dispatch('order.status.processing', payload);
  }

  @OnEvent('order.status.completed')
  async onOrderCompleted(payload: Record<string, unknown>) {
    await this.dispatch('order.status.completed', payload);
  }

  @OnEvent('order.status.in_transit')
  async onOrderInTransit(payload: Record<string, unknown>) {
    await this.dispatch('order.status.in_transit', payload);
  }

  @OnEvent('order.status.under_review')
  async onOrderUnderReview(payload: Record<string, unknown>) {
    await this.dispatch('order.status.under_review', payload);
  }

  @OnEvent('order.status.restoring')
  async onOrderRestoring(payload: Record<string, unknown>) {
    await this.dispatch('order.status.restoring', payload);
  }

  // ✅ v18: حُذف @OnEvent('order.status.shipped') — handleOrderStatusUpdated يُصدر الآن 'order.shipped' مباشرة
  // الـ listener الموحّد هو @OnEvent('order.shipped') أسفل

  @OnEvent('order.status.ready_to_ship')
  async onOrderReadyToShip(payload: Record<string, unknown>) {
    await this.dispatch('order.status.ready_to_ship', payload);
  }

  @OnEvent('order.status.pending_payment')
  async onOrderPendingPayment(payload: Record<string, unknown>) {
    await this.dispatch('order.status.pending_payment', payload);
  }

  @OnEvent('order.status.on_hold')
  async onOrderOnHold(payload: Record<string, unknown>) {
    await this.dispatch('order.status.on_hold', payload);
  }

  // ✅ v10: Listeners إضافية لحالات تأتي من order.status.updated بنص عربي
  @OnEvent('order.status.paid')
  async onOrderStatusPaid(payload: Record<string, unknown>) {
    await this.dispatch('order.status.paid', payload);
  }

  // ✅ v18: حُذف @OnEvent('order.status.cancelled') — handleOrderStatusUpdated يُصدر الآن 'order.cancelled' مباشرة
  // الـ listener الموحّد هو @OnEvent('order.cancelled') أسفل

  // ✅ v18: حُذف @OnEvent('order.status.refunded') — handleOrderStatusUpdated يُصدر الآن 'order.refunded' مباشرة
  // الـ listener الموحّد هو @OnEvent('order.refunded') أسفل

  // ✅ v18: حُذف @OnEvent('order.status.delivered') — handleOrderStatusUpdated يُصدر الآن 'order.delivered' مباشرة
  // الـ listener الموحّد هو @OnEvent('order.delivered') أسفل

  @OnEvent('order.payment.updated')
  async onOrderPaymentUpdated(payload: Record<string, unknown>) {
    await this.dispatch('order.payment.updated', payload);
  }

  @OnEvent('order.shipped')
  async onOrderShipped(payload: Record<string, unknown>) {
    await this.dispatch('order.shipped', payload);
  }

  @OnEvent('order.delivered')
  async onOrderDelivered(payload: Record<string, unknown>) {
    await this.dispatch('order.delivered', payload);
  }

  @OnEvent('order.cancelled')
  async onOrderCancelled(payload: Record<string, unknown>) {
    await this.dispatch('order.cancelled', payload);
  }

  @OnEvent('customer.created')
  async onCustomerCreated(payload: Record<string, unknown>) {
    await this.dispatch('customer.created', payload);
  }

  @OnEvent('cart.abandoned')
  async onCartAbandoned(payload: Record<string, unknown>) {
    await this.dispatch('abandoned.cart', payload);
  }

  @OnEvent('shipment.created')
  async onShipmentCreated(payload: Record<string, unknown>) {
    await this.dispatch('shipment.created', payload);
  }

  @OnEvent('tracking.refreshed')
  async onTrackingRefreshed(payload: Record<string, unknown>) {
    await this.dispatch('tracking.refreshed', payload);
  }

  @OnEvent('review.added')
  async onReviewAdded(payload: Record<string, unknown>) {
    await this.dispatch('review.added', payload);
  }

  @OnEvent('product.available')
  async onProductAvailable(payload: Record<string, unknown>) {
    await this.dispatch('product.available', payload);
  }

  // ✅ v3: أحداث إضافية
  @OnEvent('product.quantity.low')
  async onProductQuantityLow(payload: Record<string, unknown>) {
    await this.dispatch('product.quantity.low', payload);
  }

  @OnEvent('order.refunded')
  async onOrderRefunded(payload: Record<string, unknown>) {
    await this.dispatch('order.refunded', payload);
  }

  @OnEvent('product.created')
  async onProductCreated(payload: Record<string, unknown>) {
    await this.dispatch('product.created', payload);
  }

  @OnEvent('customer.otp.request')
  async onCustomerOtpRequest(payload: Record<string, unknown>) {
    await this.dispatch('customer.otp.request', payload);
  }

  @OnEvent('invoice.created')
  async onInvoiceCreated(payload: Record<string, unknown>) {
    await this.dispatch('invoice.created', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Zid-specific Events — وثائق Zid الرسمية
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * order.payment_status.update — يُطلق عند تغيير حالة الدفع إلى paid أو unpaid
   * الوثائق: payment_status_change.old/new = 'paid' | 'unpaid'
   */
  @OnEvent('order.payment_status.updated')
  async onOrderPaymentStatusUpdated(payload: Record<string, unknown>) {
    await this.dispatch('order.payment_status.updated', payload);
  }

  /**
   * abandoned_cart.completed — يُطلق عند استرداد السلة المهجورة وتحويلها لطلب
   */
  @OnEvent('cart.recovered')
  async onCartRecovered(payload: Record<string, unknown>) {
    await this.dispatch('cart.recovered', payload);
  }

  /**
   * customer.login — يُطلق عند تسجيل دخول العميل
   * الوثائق: Customer schema — id, name, email, telephone, is_active
   */
  @OnEvent('customer.login')
  async onCustomerLogin(payload: Record<string, unknown>) {
    await this.dispatch('customer.login', payload);
  }

  /**
   * customer.merchant.update — يُطلق عند تحديث بيانات التاجر المرتبطة بالعميل
   * الوثائق: business_name, tax_number, commercial_registration
   */
  @OnEvent('customer.merchant.updated')
  async onCustomerMerchantUpdated(payload: Record<string, unknown>) {
    await this.dispatch('customer.merchant.updated', payload);
  }

  /**
   * product.publish — يُطلق عند نشر المنتج
   * الوثائق: Product schema — is_published = true
   */
  @OnEvent('product.published')
  async onProductPublished(payload: Record<string, unknown>) {
    await this.dispatch('product.published', payload);
  }

  /**
   * category.create/update/delete — وثائق Zid: Category schema
   */
  @OnEvent('category.created')
  async onCategoryCreated(payload: Record<string, unknown>) {
    await this.dispatch('category.created', payload);
  }

  @OnEvent('category.updated')
  async onCategoryUpdated(payload: Record<string, unknown>) {
    await this.dispatch('category.updated', payload);
  }

  @OnEvent('category.deleted')
  async onCategoryDeleted(payload: Record<string, unknown>) {
    await this.dispatch('category.deleted', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ زد: أحداث كانت مفقودة — customer.updated / product.updated / product.deleted
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnEvent('customer.updated')
  async onCustomerUpdated(payload: Record<string, unknown>) {
    await this.dispatch('customer.updated', payload);
  }

  @OnEvent('product.updated')
  async onProductUpdated(payload: Record<string, unknown>) {
    await this.dispatch('product.updated', payload);
  }

  @OnEvent('product.deleted')
  async onProductDeleted(payload: Record<string, unknown>) {
    await this.dispatch('product.deleted', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ زد App Market Events — أحداث دورة حياة التطبيق والاشتراك
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnEvent('store.installed')
  async onStoreInstalled(payload: Record<string, unknown>) {
    await this.dispatch('store.installed', payload);
  }

  @OnEvent('store.uninstalled')
  async onStoreUninstalled(payload: Record<string, unknown>) {
    await this.dispatch('store.uninstalled', payload);
  }

  @OnEvent('store.subscription.active')
  async onSubscriptionActive(payload: Record<string, unknown>) {
    await this.dispatch('store.subscription.active', payload);
  }

  @OnEvent('store.subscription.expired')
  async onSubscriptionExpired(payload: Record<string, unknown>) {
    await this.dispatch('store.subscription.expired', payload);
  }

  @OnEvent('store.subscription.refunded')
  async onSubscriptionRefunded(payload: Record<string, unknown>) {
    await this.dispatch('store.subscription.refunded', payload);
  }

  @OnEvent('store.subscription.warning')
  async onSubscriptionWarning(payload: Record<string, unknown>) {
    await this.dispatch('store.subscription.warning', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📡 Communication Webhooks Relay — النمط السهل
  // ═══════════════════════════════════════════════════════════════════════════════
  // سلة ترسل الرقم والمحتوى جاهزين — رفيق يُرسلها فقط بدون قوالب

  @OnEvent('communication.relay.whatsapp')
  async onCommunicationWhatsapp(payload: Record<string, unknown>) {
    await this.relayCommunicationMessage('whatsapp', payload);
  }

  @OnEvent('communication.relay.sms')
  async onCommunicationSms(payload: Record<string, unknown>) {
    // SMS: يُرسَل عبر قناة SMS المتصلة للمتجر (Unifonic / Taqnyat / Gateway / Twilio)
    // OTP (auth.otp.verification): يُستخدم meta.code من سلة مباشرة بدون توليد رمز جديد
    await this.relayCommunicationMessage('sms', payload);
  }

  @OnEvent('communication.relay.email')
  async onCommunicationEmail(payload: Record<string, unknown>) {
    // Email: يُرسَل عبر MailService (SMTP) — موضوع الإيميل مُشتق من businessType
    await this.relayCommunicationMessage('email', payload);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📡 Communication Relay Logic
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ╔══════════════════════════════════════════════════════════════════════════════╗
   * ║  Communication Webhook Relay — وفق توثيق سلة الرسمي                         ║
   * ║                                                                              ║
   * ║  سلة ترسل المحتوى والأرقام جاهزة — رفيق يُرسلها عبر القناة المناسبة        ║
   * ║                                                                              ║
   * ║  WhatsApp: القناة المتصلة للمتجر (WHATSAPP_QR / WHATSAPP_OFFICIAL)          ║
   * ║  SMS:      قناة SMS المتصلة (Unifonic / Taqnyat / Gateway / Twilio)         ║
   * ║  Email:    MailService (SMTP) — موضوع الإيميل مُشتق من businessType         ║
   * ╚══════════════════════════════════════════════════════════════════════════════╝
   */
  private async relayCommunicationMessage(
    channelType: 'whatsapp' | 'sms' | 'email',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const tenantId      = payload.tenantId as string | undefined;
    const storeId       = payload.storeId  as string | undefined;
    const notifiable    = (payload.notifiable as string[]) || [];
    const content       = (payload.content   as string)   || '';
    const businessType  = (payload.businessType as string) || 'unknown';
    const entity        = payload.entity as { id: number; type: string } | null;
    const customerId    = payload.customerId as number | undefined;
    const otpCode       = payload.otpCode as string | undefined;  // ✅ من auth.otp.verification

    // ─── تحقق أساسي ───
    if (!notifiable.length || !content) {
      this.logger.warn(
        `⚠️ Communication relay [${channelType}]: skipped — no recipients or empty content`,
        { businessType, tenantId: tenantId || '❌', storeId: storeId || '❌' },
      );
      return;
    }

    this.logger.log(
      `📡 Communication relay [${channelType}]: type=${businessType}, recipients=${notifiable.length}`,
      { tenantId: tenantId || '❌', storeId: storeId || '❌', entityId: entity?.id, customerId, hasOtpCode: !!otpCode },
    );

    switch (channelType) {
      case 'whatsapp':
        await this.relayWhatsApp(tenantId, storeId, notifiable, content, businessType, entity, customerId);
        break;
      case 'sms':
        await this.relaySms(tenantId, storeId, notifiable, content, businessType, otpCode);
        break;
      case 'email':
        await this.relayEmail(notifiable, content, businessType, entity, customerId);
        break;
    }
  }

  // ─── WhatsApp Relay ─────────────────────────────────────────────────────────

  private async relayWhatsApp(
    tenantId: string | undefined,
    storeId: string | undefined,
    notifiable: string[],
    content: string,
    businessType: string,
    entity: { id: number; type: string } | null,
    customerId: number | undefined,
  ): Promise<void> {
    if (!tenantId) {
      // FIX #2b: throw بدل return — حتى يُعيد BullMQ المحاولة
      throw new Error(`WhatsApp relay: tenantId is missing (businessType=${businessType})`);
    }

    const channel = await this.findActiveWhatsAppChannel(storeId, tenantId);
    if (!channel) {
      this.logger.warn('⚠️ WhatsApp relay: no active WhatsApp channel', { storeId, tenantId, businessType });
      return;
    }

    let sent = 0, failed = 0;

    for (const recipient of notifiable) {
      if (!recipient) continue;
      const cleanPhone = this.normalizePhone(recipient);
      if (!cleanPhone) continue;

      try {
        await this.channelsService.sendWhatsAppMessage(channel.id, cleanPhone, content);
        this.logger.log(`✅ WhatsApp relay sent: [${businessType}] → ${cleanPhone}`, { entityId: entity?.id, customerId });
        sent++;
      } catch (error: unknown) {
        failed++;
        this.logger.error(
          `❌ WhatsApp relay failed: [${businessType}] → ${cleanPhone}`,
          { error: error instanceof Error ? error.message : 'Unknown', customerId },
        );
      }
    }

    this.logger.log(`📊 WhatsApp relay: ${sent} sent, ${failed} failed | type=${businessType}`);
  }

  // ─── SMS Relay ───────────────────────────────────────────────────────────────

  private async relaySms(
    tenantId: string | undefined,
    storeId: string | undefined,
    notifiable: string[],
    content: string,
    businessType: string,
    otpCode: string | undefined,
  ): Promise<void> {
    if (!tenantId) {
      // FIX #2c: throw بدل return — حتى يُعيد BullMQ المحاولة
      throw new Error(`SMS relay: tenantId is missing (businessType=${businessType})`);
    }

    // التحقق من وجود قناة SMS مفعّلة
    const smsChannel = await this.smsService.findSmsChannel(storeId, tenantId);
    if (!smsChannel) {
      this.logger.warn(
        '⚠️ SMS relay: no active SMS channel — skipped',
        { storeId, tenantId, businessType },
      );
      return;
    }

    let sent = 0, failed = 0;

    for (const recipient of notifiable) {
      if (!recipient) continue;

      try {
        if (businessType === 'auth.otp.verification' && otpCode) {
          // OTP: نستخدم otpCode من سلة مباشرة — لا نولّد رمزاً جديداً
          await this.smsService.sendOtp(tenantId, { to: recipient, code: otpCode }, storeId);
          this.logger.log(`✅ SMS OTP relay sent → ${recipient} (code from Salla)`, { tenantId });
        } else {
          // رسالة عادية: المحتوى جاهز من سلة
          await this.smsService.send(tenantId, { to: recipient, message: content }, storeId);
          this.logger.log(`✅ SMS relay sent: [${businessType}] → ${recipient}`, { tenantId });
        }
        sent++;
      } catch (error: unknown) {
        failed++;
        this.logger.error(
          `❌ SMS relay failed: [${businessType}] → ${recipient}`,
          { error: error instanceof Error ? error.message : 'Unknown', tenantId },
        );
      }
    }

    this.logger.log(`📊 SMS relay: ${sent} sent, ${failed} failed | type=${businessType}`);
  }

  // ─── Email Relay ─────────────────────────────────────────────────────────────

  private async relayEmail(
    notifiable: string[],
    content: string,
    businessType: string,
    entity: { id: number; type: string } | null,
    customerId: number | undefined,
  ): Promise<void> {
    // اشتقاق موضوع الإيميل من businessType
    const subject = this.getEmailSubject(businessType, entity);

    // تحويل نص الرسالة إلى HTML بسيط
    const html = this.textToHtml(content);

    let sent = 0, failed = 0;

    for (const recipient of notifiable) {
      if (!recipient || !recipient.includes('@')) {
        this.logger.warn(`⚠️ Email relay: invalid address: ${recipient}`);
        continue;
      }

      try {
        const result = await this.mailService.sendMail({
          to: recipient,
          subject,
          html,
          text: content,
        });

        if (result) {
          this.logger.log(`✅ Email relay sent: [${businessType}] → ${recipient}`, { entityId: entity?.id, customerId });
          sent++;
        } else {
          failed++;
          this.logger.warn(`⚠️ Email relay: sendMail returned false → ${recipient}`);
        }
      } catch (error: unknown) {
        failed++;
        this.logger.error(
          `❌ Email relay failed: [${businessType}] → ${recipient}`,
          { error: error instanceof Error ? error.message : 'Unknown' },
        );
      }
    }

    this.logger.log(`📊 Email relay: ${sent} sent, ${failed} failed | type=${businessType}`);
  }

  // ─── Email Helpers ────────────────────────────────────────────────────────────

  /**
   * اشتقاق موضوع الإيميل من businessType
   * سلة تُرسل المحتوى جاهزاً لكن بدون موضوع — نشتقه نحن
   */
  private getEmailSubject(businessType: string, entity: { id: number; type: string } | null): string {
    const subjects: Record<string, string> = {
      'order.status.confirmation':      'تأكيد طلبك',
      'order.status.updated':           'تحديث حالة طلبك',
      'order.invoice.issued':           'فاتورتك جاهزة',
      'order.shipment.created':         'طلبك في الطريق إليك',
      'order.refund.processed':         'تم استرداد المبلغ',
      'order.gift.placed':              'لديك طلب هدية جديد',
      'payment.reminder.due':           'تذكير بإتمام الدفع',
      'product.availability.alert':     'المنتج الذي أضفته عاد للمخزون',
      'product.digital.code':           'كودك الرقمي جاهز',
      'customer.cart.abandoned':        'أتممت شراء ما تركته؟',
      'customer.loyalty.earned':        'مكافأة نقاط الولاء',
      'customer.feedback.reply':        'رد على تقييمك',
      'customer.rating.request':        'شاركنا رأيك بطلبك',
      'marketing.campaign.broadcast':   'عرض خاص لك',
      'auth.otp.verification':          'رمز التحقق',
      'system.alert.general':           'إشعار من المتجر',
      'system.message.custom':          'رسالة من المتجر',
    };

    const subject = subjects[businessType] || 'إشعار من المتجر';

    // إضافة رقم الطلب/الكيان إذا متوفر
    if (entity?.id && entity?.type === 'order') {
      return `${subject} #${entity.id}`;
    }

    return subject;
  }

  /**
   * تحويل نص عادي إلى HTML بسيط مع الحفاظ على الأسطر
   * سلة ترسل content كنص عادي مُصيَّغ
   */
  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const lines = escaped.split('\n').join('<br>\n');

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; padding: 24px; background: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <p style="font-size: 16px; line-height: 1.8; color: #333; margin: 0;">${lines}</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="font-size: 12px; color: #999; margin: 0; text-align: center;">تم الإرسال عبر منصة رفيق</p>
  </div>
</body>
</html>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Main Dispatch Logic
  // ═══════════════════════════════════════════════════════════════════════════════

  private async dispatch(triggerEvent: string, payload: Record<string, unknown>): Promise<void> {
    const tenantId = payload.tenantId as string | undefined;
    const storeId = payload.storeId as string | undefined;
    const raw = (payload.raw || payload) as Record<string, unknown>;

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔍 DIAGNOSTIC: تشخيص شامل — يطبع كل المتطلبات بسطر واحد
    // ═══════════════════════════════════════════════════════════════════════════════
    {
      const diag: Record<string, unknown> = { trigger: triggerEvent, tenantId: tenantId || '❌ MISSING', storeId: storeId || '❌ MISSING' };
      
      if (tenantId) {
        // فحص القوالب
        const tplCount = await this.templateRepository.count({
          where: [
            { tenantId, triggerEvent, status: 'approved' },
            { tenantId, triggerEvent, status: 'active' },
          ],
        });
        diag.templates = tplCount > 0 ? `✅ ${tplCount}` : '❌ 0 — لا يوجد قالب مفعّل لهذا الحدث';

        // فحص القناة
        const ch = await this.findActiveWhatsAppChannel(storeId, tenantId);
        diag.whatsapp = ch ? `✅ ${ch.id}` : '❌ لا يوجد قناة واتساب متصلة';

        // فحص الهاتف
        const phone = this.extractCustomerPhone(raw);
        diag.phone = phone ? `✅ ${phone}` : '❌ لا يوجد رقم في البيانات';
      }

      this.logger.warn(`🔍 DISPATCH DIAGNOSTIC: ${JSON.stringify(diag)}`);
    }

    if (!tenantId) {
      this.logger.warn(`⚠️ No tenantId for event ${triggerEvent} - skipping`);
      return;
    }

    // ✅ FIX: dedupKey و dedupConfirmed مُعلنة خارج try حتى finally يوصلها
    let dedupKey = '';
    let dedupConfirmed = false;

    try {
      this.logger.log(`📨 Dispatching templates for: ${triggerEvent}`, { tenantId, storeId });

      // ✅ v18 FIX: Dedup بالهاتف — يمنع إرسال نفس القالب مرتين خلال 60 ثانية
      const customerPhoneForDedup = this.extractCustomerPhone(raw);
      const fallbackId = String(raw.id || raw.orderId || payload.orderId || raw.reference_id || 'unknown');
      const dedupIdentifier = customerPhoneForDedup || fallbackId;
      dedupKey = `${dedupIdentifier}-${triggerEvent}-${tenantId}`;
      const now = Date.now();

      this.logger.debug(`🔑 DEDUP: key=${dedupKey} (phone=${customerPhoneForDedup || 'N/A'}, fallback=${fallbackId})`);

      // تنظيف الـ cache من الإدخالات القديمة
      for (const [key, timestamp] of this.recentDispatches) {
        if (now - timestamp > this.DEDUP_WINDOW_MS) this.recentDispatches.delete(key);
      }

      if (this.recentDispatches.has(dedupKey)) {
        this.logger.warn(`🔁 DEDUP: Skipping duplicate dispatch for '${triggerEvent}' (key: ${dedupIdentifier}) — already sent within ${this.DEDUP_WINDOW_MS / 1000}s`);
        dedupConfirmed = true; // ← الرسالة السابقة نجحت، لا نحذف
        return;
      }
      // ✅ FIX: نسجل DEDUP مبدئياً لمنع إرسال متزامن
      // finally يحذفه إذا الإرسال فشل (حتى يمر الـ retry)
      this.recentDispatches.set(dedupKey, now);

      // 1️⃣ البحث عن القوالب المفعّلة بنفس triggerEvent
      const templates = await this.templateRepository.find({
        where: [
          { tenantId, triggerEvent, status: 'approved' },
          { tenantId, triggerEvent, status: 'active' },
        ],
      });

      // ✅ LOG level بدل DEBUG - لازم يظهر في الـ production logs
      this.logger.log(`📋 Templates found: ${templates.length} for trigger: ${triggerEvent}`, {
        tenantId,
        triggerEvent,
        templateNames: templates.map(t => t.name),
      });

      if (templates.length === 0) {
        this.logger.warn(`⚠️ No active templates found for trigger: ${triggerEvent} (tenantId: ${tenantId})`);
        return;
      }

      // ✅ v16: Template Isolation — قالب واحد فقط لكل حدث
      // إذا وُجد أكثر من قالب مفعّل لنفس الحدث → نرسل الأحدث فقط ونُحذّر
      if (templates.length > 1) {
        this.logger.warn(`⚠️ ISOLATION: ${templates.length} templates found for trigger "${triggerEvent}" — sending only the most recent one`, {
          templateNames: templates.map(t => t.name),
          templateIds: templates.map(t => t.id),
        });
      }
      // ترتيب حسب الأحدث واختيار الأول فقط
      const sortedTemplates = templates.sort((a, b) =>
        (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0)
      );
      const activeTemplate = sortedTemplates[0];

      // 2️⃣ البحث عن قناة واتساب متصلة (بـ storeId أولاً، ثم tenantId كـ fallback)
      const channel = await this.findActiveWhatsAppChannel(storeId, tenantId);
      if (!channel) {
        this.logger.warn(`⚠️ No active WhatsApp channel for store ${storeId} or tenant ${tenantId}`);
        return;
      }
      this.logger.log(`📱 WhatsApp channel found: ${channel.id} (type: ${channel.type})`);

      // 3️⃣ استخراج رقم هاتف العميل
      let customerPhone = this.extractCustomerPhone(raw);

      // ✅ v3: إذا ما لقينا الرقم من بيانات الـ webhook → نبحث في قاعدة البيانات
      if (!customerPhone) {
        this.logger.log(`🔍 Phone not in webhook data, looking up from database...`);
        customerPhone = await this.lookupCustomerPhone(raw, storeId);
      }

      if (!customerPhone) {
        this.logger.warn(`⚠️ No customer phone found for event ${triggerEvent}`, {
          rawKeys: Object.keys(raw),
          hasCustomer: !!raw.customer,
          orderId: raw.id || raw.orderId,
        });
        return;
      }

      this.logger.log(`📞 Customer phone: ${customerPhone}`);

      // 4️⃣ ✅ v16: إرسال قالب واحد فقط (Template Isolation)
      const template = activeTemplate;
      const sendSettings = template.sendSettings;

      // ✅ تحديد نوع الإرسال من sendSettings
      const mode = sendSettings?.sendingMode || SendingMode.INSTANT;

      if (mode === SendingMode.MANUAL) {
        this.logger.log(`⏭️ Skipping manual template: "${template.name}"`);
        return;
      }

      // ✅ v15: فحص شرط الحالة — يعمل مع CONDITIONAL و DELAYED
      if (sendSettings?.triggerCondition && (mode === SendingMode.CONDITIONAL || mode === SendingMode.DELAYED)) {
        const condition = sendSettings.triggerCondition;

        if (condition.orderStatus) {
          const currentStatus = String(raw.status || raw.newStatus || '').toLowerCase();
          if (currentStatus && currentStatus !== condition.orderStatus.toLowerCase()) {
            this.logger.log(
              `⏭️ Condition not met: "${template.name}" requires status "${condition.orderStatus}", got "${currentStatus}"`,
            );
            return;
          }
        }

        if (condition.paymentMethod) {
          const currentMethod = String(
            raw.payment_method || (raw as any).paymentMethod || '',
          ).toLowerCase();
          if (currentMethod && currentMethod !== condition.paymentMethod.toLowerCase()) {
            this.logger.log(
              `⏭️ Condition not met: "${template.name}" requires payment "${condition.paymentMethod}", got "${currentMethod}"`,
            );
            return;
          }
        }
      }

      // ✅ Delayed أو Conditional مع تأخير: جدولة بدل إرسال فوري
      const delayMinutes = sendSettings?.delayMinutes;
      if (delayMinutes && delayMinutes > 0 && (mode === SendingMode.DELAYED || mode === SendingMode.CONDITIONAL)) {
        this.logger.log(
          `⏰ Scheduling: "${template.name}" → ${customerPhone} (delay: ${delayMinutes}min)`,
        );

        const orderId = String(raw.id || raw.orderId || raw.order_id || '');
        await this.templateSchedulerService.scheduleDelayedSend({
          template,
          tenantId,
          storeId,
          customerPhone,
          customerName: String(
            (raw.customer as any)?.first_name ||
            (raw.customer as any)?.name ||
            raw.customerName ||
            '',
          ),
          referenceId: orderId || undefined,
          referenceType: triggerEvent.split('.')[0] || undefined,
          triggerEvent,
          payload: raw,
          delayMinutes,
          sequenceGroupKey: sendSettings?.sequence?.groupKey,
          sequenceOrder: sendSettings?.sequence?.order,
        });

        dedupConfirmed = true; // ✅ الجدولة نجحت → DEDUP مؤكد
        return; // لا ترسل فورياً
      }

      // ✅ Instant: إرسال فوري
      this.logger.log(`📤 Sending template: "${template.name}" for trigger: ${triggerEvent}`);
      const sendSuccess = await this.sendTemplate(template, channel, customerPhone, raw);

      if (sendSuccess) {
        dedupConfirmed = true; // ✅ إرسال نجح → DEDUP مؤكد
      }
      // إذا فشل → dedupConfirmed = false → finally يحذف DEDUP

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Template dispatch failed for ${triggerEvent}: ${msg}`, {
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      // ✅ FIX: إذا الإرسال ما تأكد (فشل / خطأ / لا قناة / لا رقم) → نحذف DEDUP
      // حتى الـ webhook الثاني يقدر يحاول مرة ثانية
      if (!dedupConfirmed && dedupKey) {
        this.recentDispatches.delete(dedupKey);
        this.logger.debug(`🔓 DEDUP released for '${triggerEvent}' — not confirmed`);
      }
    }
  }

  /**
   * إرسال قالب واحد
   */
  private async sendTemplate(
    template: MessageTemplate,
    channel: Channel,
    customerPhone: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const message = this.replaceVariables(template.body, data);

      this.logger.log(`📤 Sending "${template.name}" to ${customerPhone}`, {
        channelId: channel.id,
        templateId: template.id,
        messagePreview: message.substring(0, 80) + '...',
      });

      const result = await this.channelsService.sendWhatsAppMessage(
        channel.id,
        customerPhone,
        message,
      );

      this.logger.log(`✅ Message sent: "${template.name}" → ${customerPhone}`, {
        messageId: result?.messageId || 'N/A',
      });

      // تحديث إحصائيات الاستخدام
      await this.incrementUsage(template.id);
      return true;

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Failed to send "${template.name}" → ${customerPhone}: ${msg}`, {
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Phone Lookup Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * استخراج رقم هاتف العميل من بيانات الـ webhook
   */
  private extractCustomerPhone(data: Record<string, unknown>): string | null {
    // 1. من كائن customer (top-level)
    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer) {
      const fullPhone = this.buildFullPhone(customer);
      if (fullPhone) {
        this.logger.log(`📞 Phone found in webhook customer object: ${fullPhone}`);
        return this.normalizePhone(fullPhone);
      }
    }

    // ✅ v4: من كائن order.customer (سلة ترسل order.status.updated بهالشكل)
    const orderObj = data.order as Record<string, unknown> | undefined;
    if (orderObj) {
      const orderCustomer = orderObj.customer as Record<string, unknown> | undefined;
      if (orderCustomer) {
        const fullPhone = this.buildFullPhone(orderCustomer);
        if (fullPhone) {
          this.logger.log(`📞 Phone found in order.customer: ${fullPhone}`);
          return this.normalizePhone(fullPhone);
        }
      }
      // ✅ v4: من order.shipping_address
      const orderShipping = orderObj.shipping_address as Record<string, unknown> | undefined;
      if (orderShipping?.phone) {
        this.logger.log(`📞 Phone found in order.shipping_address: ${orderShipping.phone}`);
        return this.normalizePhone(String(orderShipping.phone));
      }
    }

    // 2. من الحقول المباشرة
    const directPhone = data.customerPhone || data.mobile || data.phone;
    if (directPhone) {
      this.logger.log(`📞 Phone found in direct field: ${directPhone}`);
      return this.normalizePhone(String(directPhone));
    }

    // 3. من عنوان الشحن (top-level)
    const shipping = data.shipping_address as Record<string, unknown> | undefined;
    if (shipping?.phone) {
      this.logger.log(`📞 Phone found in shipping_address: ${shipping.phone}`);
      return this.normalizePhone(String(shipping.phone));
    }

    // 4. من receiver
    const receiver = data.receiver as Record<string, unknown> | undefined;
    if (receiver?.phone || receiver?.mobile) {
      const p = receiver.phone || receiver.mobile;
      this.logger.log(`📞 Phone found in receiver: ${p}`);
      return this.normalizePhone(String(p));
    }

    this.logger.log(`📞 No phone in webhook data (keys: ${Object.keys(data).join(', ')})`);
    return null;
  }

  /**
   * ✅ v3: جلب رقم العميل من قاعدة البيانات
   * يبحث عن الطلب بـ sallaOrderId ثم يجلب رقم العميل من جدول customers
   */
  private async lookupCustomerPhone(
    data: Record<string, unknown>,
    storeId?: string,
  ): Promise<string | null> {
    if (!storeId) return null;

    try {
      // ✅ v4: البحث في data.id أو داخل data.order.id (سلة ترسل بيانات مختلفة حسب الحدث)
      const orderObj = data.order as Record<string, unknown> | undefined;
      const orderId = data.id || data.orderId || data.order_id || orderObj?.id || orderObj?.order_id;
      if (!orderId) {
        this.logger.log(`🔍 No order ID in data to lookup phone`);
        return null;
      }

      const sallaOrderId = String(orderId);
      this.logger.log(`🔍 Looking up order with sallaOrderId: ${sallaOrderId}, storeId: ${storeId}`);

      // البحث عن الطلب بـ sallaOrderId
      const order = await this.orderRepository.findOne({
        where: { storeId, sallaOrderId },
        relations: ['customer'],
      });

      if (!order) {
        this.logger.log(`🔍 Order not found in DB for sallaOrderId: ${sallaOrderId}`);

        // محاولة بديلة: البحث بالـ reference_id
        const refId = data.reference_id || data.referenceId;
        if (refId) {
          const orderByRef = await this.orderRepository.findOne({
            where: { storeId, referenceId: String(refId) } as any,
            relations: ['customer'],
          });
          if (orderByRef?.customer?.phone) {
            this.logger.log(`📞 Phone found via reference_id: ${orderByRef.customer.phone}`);
            return this.normalizePhone(orderByRef.customer.phone);
          }
        }

        return null;
      }

      // جلب الرقم من العميل
      if (order.customer?.phone) {
        this.logger.log(`📞 Phone found from DB customer: ${order.customer.phone}`);
        return this.normalizePhone(order.customer.phone);
      }

      // إذا ما لقينا العميل بالعلاقة → نبحث مباشرة
      if (order.customerId) {
        const customer = await this.customerRepository.findOne({
          where: { id: order.customerId },
          select: ['id', 'phone'],
        });
        if (customer?.phone) {
          this.logger.log(`📞 Phone found from customer lookup: ${customer.phone}`);
          return this.normalizePhone(customer.phone);
        }
      }

      // ✅ v4: محاولة أخيرة - البحث في metadata.sallaData عن رقم العميل
      const sallaData = (order.metadata as any)?.sallaData as Record<string, unknown> | undefined;
      if (sallaData) {
        const sallaCustomer = sallaData.customer as Record<string, unknown> | undefined;
        const sallaPhone = sallaCustomer?.mobile || sallaCustomer?.phone || sallaData.customer_phone;
        if (sallaPhone) {
          this.logger.log(`📞 Phone found from order sallaData: ${sallaPhone}`);
          return this.normalizePhone(String(sallaPhone));
        }
        // من shipping_address في sallaData
        const sallaShipping = sallaData.shipping_address as Record<string, unknown> | undefined;
        if (sallaShipping?.phone) {
          this.logger.log(`📞 Phone found from sallaData shipping: ${sallaShipping.phone}`);
          return this.normalizePhone(String(sallaShipping.phone));
        }
      }

      this.logger.warn(`⚠️ Order found but no customer phone (orderId: ${order.id})`);
      return null;

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Error looking up customer phone: ${msg}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Channel & Phone Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * البحث عن قناة واتساب متصلة
   * 
   * ✅ FIX: كان يبحث بـ storeId فقط → ما يلاقي القناة إذا كانت مربوطة بمتجر ثاني
   * الحل: إذا ما لقى بـ storeId → يبحث بـ tenantId (نفس المالك = نفس القنوات)
   * 
   * مثال: الواتساب مربوط بـ "متجر تجريبي" لكن الويب هوك من متجر سلة الحقيقي
   * كلاهما تحت نفس tenantId → يلاقي القناة
   */
  private async findActiveWhatsAppChannel(storeId?: string, tenantId?: string): Promise<Channel | null> {
    // 1️⃣ البحث بـ storeId المباشر (الأدق)
    if (storeId) {
      const channel = await this.channelRepository.findOne({
        where: [
          { storeId, type: ChannelType.WHATSAPP_QR, status: ChannelStatus.CONNECTED },
          { storeId, type: ChannelType.WHATSAPP_OFFICIAL, status: ChannelStatus.CONNECTED },
        ],
      });

      if (channel) return channel;
    }

    // 2️⃣ Fallback: أي قناة واتساب متصلة تحت نفس الـ tenant
    // هذا يحل مشكلة: الواتساب مربوط بمتجر A لكن الويب هوك من متجر B (نفس المالك)
    if (tenantId) {
      this.logger.debug(`🔍 No WhatsApp for store ${storeId} — searching by tenantId: ${tenantId}`);

      const channel = await this.channelRepository
        .createQueryBuilder('channel')
        .innerJoin('channel.store', 'store')
        .where('store.tenantId = :tenantId', { tenantId })
        .andWhere('channel.type IN (:...types)', {
          types: [ChannelType.WHATSAPP_QR, ChannelType.WHATSAPP_OFFICIAL],
        })
        .andWhere('channel.status = :status', { status: ChannelStatus.CONNECTED })
        .getOne();

      if (channel) {
        this.logger.log(
          `📱 WhatsApp found via tenant fallback: ${channel.id} (store: ${channel.storeId})`,
        );
        return channel;
      }
    }

    return null;
  }

  /**
   * تنظيف رقم الهاتف
   */
  /**
   * ✅ v7: بناء الرقم الكامل من mobile_code + mobile
   * سلة ترسل: { mobile: "561667877", mobile_code: "971" }
   * النتيجة: "971561667877"
   * 
   * القاعدة: نأخذ الرقم كما هو من سلة بدون أي تعديل
   * يشتغل مع أي دولة (سعودي، إماراتي، أمريكي، روسي...)
   */
  private buildFullPhone(obj: Record<string, unknown>): string | null {
    const mobileCode = obj.mobile_code || obj.country_code || obj.countryCode;
    const mobile = obj.mobile;

    // ✅ لو فيه mobile_code + mobile → نجمعهم
    if (mobileCode && mobile) {
      const code = String(mobileCode).replace(/[^0-9]/g, '');
      const num = String(mobile).replace(/[^0-9]/g, '');
      if (code && num) {
        this.logger.log(`📞 Built phone from mobile_code(${code}) + mobile(${num})`);
        return code + num;
      }
    }

    // ✅ لو فيه phone كامل (مثل "+971561667877") → نستخدمه كما هو
    if (obj.phone) return String(obj.phone);

    // ✅ لو فيه mobile بس بدون code → نرجعه كما هو
    if (mobile) return String(mobile);

    return null;
  }

  /**
   * ✅ v7: تنظيف رقم الهاتف - فقط إزالة رموز بدون تغيير كود الدولة
   * 
   * القاعدة: لا نفترض أي كود دولة - الرقم يمر كما هو
   * الأرقام اللي تجي من buildFullPhone أو من سلة مباشرة تكون كاملة
   */
  private normalizePhone(phone: string): string {
    if (!phone) return '';
    // إزالة المسافات والشرطات والأقواس
    let n = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
    // أرقام سعودية: 05XXXXXXXX → 9665XXXXXXXX
    if (n.startsWith('05') && n.length === 10)  n = '966' + n.slice(1);
    // سعودي بدون صفر: 5XXXXXXXX → 9665XXXXXXXX
    else if (n.startsWith('5') && n.length === 9)  n = '966' + n;
    return n;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Template Processing
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * استبدال المتغيرات في نص القالب
   */
  private replaceVariables(body: string, data: Record<string, unknown>): string {
    let message = body;

    // ✅ v18: safeString — يمنع [object Object] من الظهور في الرسائل
    // سلة قد ترسل حقول كـ objects: { name: "ملغي", slug: "cancelled" }
    const safeStr = (val: unknown, fallback = ''): string => {
      if (val === null || val === undefined) return fallback;
      if (typeof val === 'string') return val || fallback;
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      if (typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        // استخراج القيمة من الأنماط الشائعة لسلة
        const extracted = obj.name || obj.slug || obj.value || obj.text || obj.title || obj.first_name;
        if (extracted && typeof extracted === 'string') return extracted;
        if (extracted && typeof extracted === 'number') return String(extracted);
        // آخر محاولة: لا نُرجع [object Object]
        this.logger.warn(`⚠️ safeStr: received object, falling back`, { keys: Object.keys(obj), raw: JSON.stringify(obj).substring(0, 150) });
        return fallback;
      }
      return String(val) || fallback;
    };

    // ✅ v5: استخراج البيانات من كل المستويات (top-level + nested order)
    const orderObj = (data.order || {}) as Record<string, unknown>;
    const customer = (data.customer || orderObj.customer || {}) as Record<string, unknown>;
    const urls = (data.urls || orderObj.urls || {}) as Record<string, unknown>;

    // ✅ v16: DEBUG log لقيمة total
    const rawTotal = data.total || orderObj.total;
    if (rawTotal && typeof rawTotal === 'object') {
      this.logger.debug(`💰 total is object: ${JSON.stringify(rawTotal).substring(0, 200)}`);
    }

    const variables: Record<string, string> = {
      // ✅ v18: كل القيم تمر عبر safeStr لمنع [object Object]
      customer_name: safeStr(customer.first_name || customer.name || data.customerName, 'عميلنا الكريم'),
      customer_first_name: safeStr(customer.first_name || data.customerName, 'عميلنا'),
      customer_phone: safeStr(customer.mobile || customer.phone),
      customer_email: safeStr(customer.email),
      order_id: safeStr(data.reference_id || orderObj.reference_id || data.order_number || orderObj.order_number || data.id || orderObj.id || data.orderId),
      order_total: this.formatAmount(data.total || orderObj.total || (data.amounts as any)?.total || (orderObj.amounts as any)?.total),
      order_status: safeStr(data.status || data.newStatus || orderObj.status),
      order_date: new Date().toLocaleDateString('ar-SA'),
      order_tracking: safeStr(urls.tracking || data.tracking_url || orderObj.tracking_url),
      tracking_number: safeStr(data.tracking_number || data.trackingNumber || orderObj.tracking_number),
      shipping_company: safeStr(data.shipping_company || data.shippingCompany || orderObj.shipping_company),
      store_name: safeStr(data.store_name || orderObj.store_name, 'متجرنا'),
      store_url: safeStr(data.store_url),
      cart_total: this.formatAmount(data.total || data.cartTotal || orderObj.total),
      cart_link: safeStr(data.cart_url || data.checkout_url || orderObj.checkout_url),
      product_name: safeStr(data.name || data.productName),
      product_price: this.formatAmount(data.price || orderObj.price),
      payment_link: safeStr(data.payment_url || data.checkout_url || orderObj.payment_url),
    };

    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }

    // تنظيف المتغيرات غير المستبدلة
    message = message.replace(/\{\{[^}]+\}\}/g, '');

    return message.trim();
  }

  private formatAmount(amount: unknown): string {
    if (!amount) return '0';

    // ✅ v16: سلة قد ترسل total كـ object: { amount: 299, currency: "SAR" }
    if (typeof amount === 'object' && amount !== null) {
      const obj = amount as Record<string, unknown>;
      // استخراج القيمة من الحقول المحتملة
      const numVal = obj.amount ?? obj.value ?? obj.total ?? obj.price ?? obj.grand_total;
      if (numVal !== undefined && numVal !== null) {
        const num = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
        if (!isNaN(num)) return num.toLocaleString('ar-SA');
      }
      // آخر محاولة: تحويل الـ object لـ JSON لتجنب [object Object]
      this.logger.warn(`⚠️ formatAmount received object without amount field:`, { keys: Object.keys(obj), raw: JSON.stringify(obj).substring(0, 200) });
      return '0';
    }

    const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (isNaN(num)) return String(amount);
    return num.toLocaleString('ar-SA');
  }

  /**
   * تحديث عداد الاستخدام
   */
  private async incrementUsage(templateId: string): Promise<void> {
    try {
      await this.templateRepository
        .createQueryBuilder()
        .update(MessageTemplate)
        .set({
          stats: () =>
            `jsonb_set(COALESCE(stats, '{"usageCount":0}'::jsonb), '{usageCount}', (COALESCE((stats->>'usageCount')::int, 0) + 1)::text::jsonb)`,
        })
        .where('id = :id', { id: templateId })
        .execute();
    } catch {
      this.logger.warn(`Failed to increment usage for template ${templateId}`);
    }
  }
}
