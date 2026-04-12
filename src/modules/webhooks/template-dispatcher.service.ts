/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Template Dispatcher Service                      ║
 * ║                                                                                ║
 * ║  ✅ v23: Communication Trigger Mapping Fix + Multi-Template Support            ║
 * ║                                                                                ║
 * ║  ══ قاعدة رفيق الصارمة (غير قابلة للخرق) ══                                  ║
 * ║  • يُرسَل قالب التاجر المفعَّل دائماً — لا محتوى سلة الافتراضي أبداً          ║
 * ║  • إذا لا يوجد قالب → skip تام (تحذير للمطور فقط)                             ║
 * ║  • كل businessType = trigger مستقل = قالب مستقل = ZERO تداخل                 ║
 * ║                                                                                ║
 * ║  ══ إصلاحات v23 ══                                                             ║
 * ║  #1 TRIGGER_ALIAS_MAP: 7 mappings بين أسماء سلة وأسماء قوالب رفيق            ║
 * ║     order.notification.create → order.created                                  ║
 * ║     order.refund.processed → order.refunded                                    ║
 * ║     order.shipment.created → shipment.created                                  ║
 * ║     order.invoice.issued → invoice.created                                     ║
 * ║     customer.cart.abandoned → abandoned.cart                                    ║
 * ║     product.availability.alert → product.available                             ║
 * ║  #2 Multi-Template: relayCommunicationMessage يدعم قوالب متعددة لنفس trigger  ║
 * ║     فوري (instant) + مؤجل (delayed) + يدوي (manual skip) في نفس الوقت        ║
 * ║  #3 resolveTemplateForCommunication حُذف — نُقلت وظيفته إلى relay مباشرة     ║
 * ║  #4 OTP bypass يعمل داخل relayCommunicationMessage مباشرة                     ║
 * ║                                                                                ║
 * ║  ══ المسارين المستقلين ══                                                      ║
 * ║  ① Regular Webhook  → OnEvent → dispatch() → قالب بـ trigger = eventName      ║
 * ║  ② Communication    → OnEvent → relayCommunicationMessage                     ║
 * ║                      → TRIGGER_ALIAS_MAP → find ALL templates                 ║
 * ║                      → instant: إرسال فوري | delayed: جدولة | manual: skip   ║
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
import { CommunicationEventType } from './dto/salla-webhook.dto';

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

  /**
   * ✅ الحالات التي تعني "القالب مفعّل ويجب الإرسال"
   * رفيق لا يستخدم Meta approval workflow —
   * أي قالب أنشأه التاجر يُعتبر مفعّلاً ما لم يكن disabled أو rejected
   */
  private readonly ACTIVE_STATUSES = ['active', 'approved', 'draft'] as const;

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

  // ✅ v21: أحداث مستقلة لكل طريقة دفع — فصل كامل من المصدر
  // order.cod.created    → قالب "تأكيد الدفع عند الاستلام"
  // order.online.created → قالب "تأكيد الدفع الإلكتروني" (مستقبلاً)
  @OnEvent('order.cod.created')
  async onOrderCodCreated(payload: Record<string, unknown>) {
    await this.dispatch('order.cod.created', payload);
  }

  @OnEvent('order.online.created')
  async onOrderOnlineCreated(payload: Record<string, unknown>) {
    await this.dispatch('order.online.created', payload);
  }

  // ✅ v8: حُذف @OnEvent('order.status.updated') العام نهائياً - كل حالة لها listener خاص

  // ✅ Events خاصة بكل حالة طلب - كل حالة ترسل القالب الصحيح
  // القاعدة: trigger واحد لكل حالة — الترجمة slug→trigger تحدث في الـ Processor
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
   * ║  Communication Webhook Relay — v21 RADICAL FIX                              ║
   * ║                                                                              ║
   * ║  القاعدة الأساسية لـ رفيق:                                                   ║
   * ║  • يُرسَل دائماً قالب التاجر المفعَّل — ليس محتوى سلة الافتراضي            ║
   * ║  • إذا لا يوجد قالب مفعَّل → لا تُرسَل أي رسالة (skip + تحذير)             ║
   * ║  • كل businessType مستقل تماماً — لا تداخل بين الأنواع                      ║
   * ║  • dedup: نفس الإشعار لا يُرسَل مرتين خلال 60 ثانية                        ║
   * ║                                                                              ║
   * ║  المسار الصحيح:                                                              ║
   * ║  Webhook → Processor → EventEmitter                                          ║
   * ║  → ابحث عن قالب مفعَّل بـ trigger = businessType (EXACT)                    ║
   * ║  → وُجد: استبدل المتغيرات من بيانات الكيان → أرسل                           ║
   * ║  → لم يُوجد: سجّل تحذير ← لا تُرسل شيئاً                                   ║
   * ║                                                                              ║
   * ║  ❌ ممنوع تماماً:                                                            ║
   * ║  • إرسال محتوى سلة الافتراضي كـ fallback                                    ║
   * ║  • fallback chains (order.status.confirmation → order.status.pending_payment)║
   * ║  • إرسال قالب نوع آخر (قالب order.created لـ order.status.confirmation)     ║
   * ╚══════════════════════════════════════════════════════════════════════════════╝
   */
  private async relayCommunicationMessage(
    channelType: 'whatsapp' | 'sms' | 'email',
    payload: Record<string, unknown>,
  ): Promise<void> {

    // ─── استخراج البيانات ──────────────────────────────────────────────────────
    const tenantId     = payload.tenantId     as string | undefined;
    const storeId      = payload.storeId      as string | undefined;
    const notifiable   = (payload.notifiable  as string[]) || [];
    const sallaContent = (payload.content     as string)   || '';
    const businessType = (payload.businessType as string)  || 'unknown';
    const entityRaw    = payload.entity as { id: number | string; type: string } | null;
    const entity: { id: number; type: string } | null = entityRaw
      ? { id: Number(entityRaw.id), type: entityRaw.type }
      : null;
    const customerId   = payload.customerId as number | undefined;
    const otpCode      = payload.otpCode    as string | undefined;
    const rawData      = (payload.raw || {}) as Record<string, unknown>;

    // ─── تحقق أساسي: يجب أن يكون هناك مستلمون ────────────────────────────────
    if (!notifiable.length) {
      this.logger.warn(
        `⚠️ Communication relay [${channelType}] [${businessType}]: skipped — empty notifiable[]`,
        { tenantId: tenantId || '❌', storeId: storeId || '❌' },
      );
      return;
    }

    if (!tenantId) {
      this.logger.error(
        `❌ Communication relay [${channelType}] [${businessType}]: missing tenantId — cannot find templates`,
        { storeId: storeId || '❌' },
      );
      return;
    }

    // ─── DEDUP: منع إرسال نفس الإشعار مرتين عبر communication relay ──────
    // كل مسار (dispatch / comm relay) له DEDUP مستقل
    // لا نفحص dispatch key لأنه قد يُحذف بعد فشل الإرسال (timing issue)
    const commDedupKey = `comm:${notifiable[0]}-${businessType}-${tenantId}`;
    const now = Date.now();

    // تنظيف cache من الإدخالات القديمة
    for (const [key, ts] of this.recentDispatches) {
      if (now - ts > this.DEDUP_WINDOW_MS) this.recentDispatches.delete(key);
    }

    if (this.recentDispatches.has(commDedupKey)) {
      this.logger.warn(
        `🔁 Communication relay DEDUP: already sent [${businessType}] → ${notifiable[0]}`,
      );
      return;
    }

    this.logger.log(
      `📡 Communication relay [${channelType}]: type=${businessType}, recipients=${notifiable.length}`,
      {
        tenantId,
        storeId:   storeId   || '❌',
        entityType: entity?.type || 'null',
        entityId:   entity?.id   || 'null',
        customerId: customerId   ?? 'N/A',
      },
    );

    // ─── Debug: log raw meta for cart/product events (مؤقت — لتشخيص المتغيرات) ──
    if (entity?.type === 'cart' || entity?.type === 'product') {
      const meta = (rawData?.meta || {}) as Record<string, unknown>;
      this.logger.log(`🔍 Raw meta for [${businessType}]:`, { meta: JSON.stringify(meta).substring(0, 500) });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🎯 v23: Multi-Template Communication Relay
    //
    // ✅ قاعدة رفيق الصارمة:
    // • قالب التاجر = المصدر الوحيد للرسالة
    // • لا محتوى سلة كـ fallback
    // • OTP استثناء: سلة تبني الرسالة مع الرمز الحقيقي
    //
    // ✅ v23: دعم قوالب متعددة لنفس الـ trigger
    // مثال: order.created يطلق "طلب جديد" (فوري) + "طلب تقييم" (مؤجل 3 أيام)
    // كل قالب يُعالَج حسب sendSettings الخاصة به
    // ═══════════════════════════════════════════════════════════════════════════

    try {

    // ─── استثناء OTP: إرسال محتوى سلة مباشرة ─────────────────────────────
    if (businessType === CommunicationEventType.AUTH_OTP_VERIFICATION) {
      this.logger.log(`🔑 OTP: sending Salla content directly (time-sensitive code)`);
      this.recentDispatches.set(commDedupKey, now);

      switch (channelType) {
        case 'whatsapp':
          await this.relayWhatsApp(tenantId, storeId, notifiable, sallaContent, businessType, entity, customerId);
          break;
        case 'sms':
          await this.relaySms(tenantId, storeId, notifiable, sallaContent, businessType, otpCode);
          break;
        case 'email':
          await this.relayEmail(notifiable, sallaContent, businessType, entity, customerId);
          break;
      }
      return;
    }

    // ─── تحديد triggers المطلوب البحث بها ────────────────────────────────
    const triggerCandidates = await this.resolveCommunicationTrigger(
      businessType, entity, storeId, sallaContent,
    );

    if (!triggerCandidates.length) {
      this.logger.warn(`⚠️ No trigger candidates for "${businessType}"`);
      return;
    }

    // ─── البحث عن كل القوالب المفعَّلة (ليس واحداً فقط) ─────────────────
    const allTemplates = await this.templateRepository.find({
      where: triggerCandidates.flatMap(t =>
        this.ACTIVE_STATUSES.map(s => ({ tenantId, triggerEvent: t, status: s as any })),
      ),
      order: { updatedAt: 'DESC' },
    });

    if (!allTemplates.length) {
      const tenantTemplates = await this.templateRepository.find({
        where: { tenantId },
        select: ['id', 'name', 'triggerEvent', 'status'] as any,
        order: { updatedAt: 'DESC' } as any,
        take: 20,
      });

      this.logger.warn(
        `⏭️  [${businessType}] SKIPPED — no active template`,
        {
          tenantId,
          searched_triggers: triggerCandidates,
          hint: `Create & activate a template with triggerEvent="${triggerCandidates[0]}"`,
          tenant_templates: tenantTemplates.map((t: any) => ({
            name: t.name, trigger: t.triggerEvent, status: t.status,
          })),
        },
      );
      return;
    }

    // ─── تسجيل DEDUP بعد تأكيد وجود قوالب ────────────────────────────────
    this.recentDispatches.set(commDedupKey, now);

    // ─── جلب بيانات الكيان (مرة واحدة — مشتركة بين كل القوالب) ──────────
    const entityData = await this.buildTemplateVariables(
      entity, storeId, sallaContent, businessType, customerId, rawData,
    );

    this.logger.log(
      `📋 Communication relay: ${allTemplates.length} template(s) matched for [${businessType}]`,
      { templates: allTemplates.map(t => ({ name: t.name, mode: t.sendSettings?.sendingMode || 'instant' })) },
    );

    // ─── معالجة كل قالب حسب إعداداته ─────────────────────────────────────
    for (const template of allTemplates) {
      const sendSettings = template.sendSettings;
      const mode = sendSettings?.sendingMode || SendingMode.INSTANT;

      // ⏭️ قالب يدوي → تخطي
      if (mode === SendingMode.MANUAL) {
        this.logger.log(`⏭️ Skipping MANUAL template: "${template.name}"`);
        continue;
      }

      // ⏰ قالب مؤجل → جدولة عبر TemplateSchedulerService
      const delayMinutes = sendSettings?.delayMinutes;
      if (delayMinutes && delayMinutes > 0 && (mode === SendingMode.DELAYED || mode === SendingMode.CONDITIONAL)) {
        const customerPhone = notifiable[0] ? this.normalizePhone(notifiable[0]) : '';
        if (!customerPhone) {
          this.logger.warn(`⚠️ Delayed template "${template.name}" skipped — no valid phone in notifiable`);
          continue;
        }

        const customerName = String(
          entityData.customer_name || entityData.customer_first_name || 'عميلنا الكريم',
        );
        const referenceId = String(entityData.reference_id || entityData.order_id || entity?.id || '');

        try {
          this.logger.log(
            `⏰ Scheduling delayed template: "${template.name}" → ${customerPhone} (delay: ${delayMinutes}min)`,
            { templateId: template.id, mode, delayMinutes },
          );

          await this.templateSchedulerService.scheduleDelayedSend({
            template,
            tenantId,
            storeId,
            customerPhone,
            customerName,
            referenceId: referenceId || undefined,
            referenceType: businessType.split('.')[0] || undefined,
            triggerEvent: template.triggerEvent || businessType,
            payload: entityData as Record<string, unknown>,
            delayMinutes,
            sequenceGroupKey: sendSettings?.sequence?.groupKey,
            sequenceOrder: sendSettings?.sequence?.order,
          });

          await this.incrementUsage(template.id);
        } catch (error) {
          this.logger.error(
            `❌ Failed to schedule "${template.name}" [${businessType}]: ${error instanceof Error ? error.message : 'Unknown'}`,
          );
        }
        continue;
      }

      // ⚡ قالب فوري → تصيير وإرسال
      const rendered = this.replaceVariables(template.body, entityData);

      this.logger.log(
        `📤 Sending "${template.name}" [${businessType}] → ${notifiable.length} recipient(s)`,
        { templateId: template.id, preview: rendered.substring(0, 80) },
      );

      try {
        switch (channelType) {
          case 'whatsapp':
            await this.relayWhatsApp(tenantId, storeId, notifiable, rendered, businessType, entity, customerId);
            break;
          case 'sms':
            await this.relaySms(tenantId, storeId, notifiable, rendered, businessType, otpCode);
            break;
          case 'email':
            await this.relayEmail(notifiable, rendered, businessType, entity, customerId);
            break;
        }
        await this.incrementUsage(template.id);
      } catch (error) {
        this.logger.error(
          `❌ Failed to send "${template.name}" [${businessType}]: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
      }
    }

    } catch (error) {
      // ✅ v23: Top-level catch — يمنع crash الخادم عند أخطاء غير متوقعة
      // بدون هذا: خطأ في DB/Redis → unhandledRejection → process.exit(1)
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(
        `❌ Communication relay [${channelType}] [${businessType}] FAILED: ${msg}`,
        { tenantId, storeId, stack: error instanceof Error ? error.stack : undefined },
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // v23: resolveTemplateForCommunication حُذف — نُقلت وظيفته إلى
  // relayCommunicationMessage الذي يدعم الآن قوالب متعددة per trigger
  // (فوري + مؤجل + شرطي في نفس الوقت)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ╔══════════════════════════════════════════════════════════════════════════════╗
   * ║  resolveCommunicationTrigger — v23 COMPLETE MAPPING FIX                     ║
   * ║                                                                              ║
   * ║  المشكلة الجذرية:                                                           ║
   * ║  سلة ترسل أسماء أحداث في Communication Webhooks (data.type) مختلفة          ║
   * ║  عن أسماء الـ triggers المستخدمة في قوالب رفيق (presets).                   ║
   * ║  مثال: سلة ترسل customer.cart.abandoned لكن القالب يستخدم abandoned.cart    ║
   * ║                                                                              ║
   * ║  الحل: TRIGGER_ALIAS_MAP — نبحث بكلا الاسمين:                              ║
   * ║  [اسم سلة الأصلي, اسم القالب في رفيق]                                      ║
   * ║                                                                              ║
   * ║  ┌──────────────────────────────┬─────────────────────────────────┐          ║
   * ║  │ Salla Communication type     │ Rafeq template trigger(s)      │          ║
   * ║  ├──────────────────────────────┼─────────────────────────────────┤          ║
   * ║  │ order.notification.create    │ + order.created                 │          ║
   * ║  │ order.status.confirmation    │ + order.created                 │          ║
   * ║  │ order.status.updated         │ DB lookup → order.status.{slug} │          ║
   * ║  │ order.refund.processed       │ + order.refunded                │          ║
   * ║  │ order.shipment.created       │ + shipment.created              │          ║
   * ║  │ order.invoice.issued         │ + invoice.created               │          ║
   * ║  │ payment.reminder.due         │ + order.status.pending_payment  │          ║
   * ║  │ customer.cart.abandoned      │ + abandoned.cart                 │          ║
   * ║  │ product.availability.alert   │ + product.available             │          ║
   * ║  │ customer.rating.request      │ (exact — no alias needed)       │          ║
   * ║  │ auth.otp.verification        │ bypass (OTP direct)             │          ║
   * ║  │ others                       │ (exact — businessType نفسه)     │          ║
   * ║  └──────────────────────────────┴─────────────────────────────────┘          ║
   * ╚══════════════════════════════════════════════════════════════════════════════╝
   */
  private async resolveCommunicationTrigger(
    businessType: string,
    entity: { id: number; type: string } | null,
    storeId: string | undefined,
    sallaContent?: string,
  ): Promise<string[]> {

    // ─── order.status.updated: نحتاج الحالة الفعلية من DB ──────────────────
    // سلة ترسل هذا الـ businessType لكل تغيير حالة
    // التاجر يُنشئ قوالب مختلفة لكل حالة (order.status.in_transit, order.delivered...)
    if (businessType === 'order.status.updated') {
      if (entity?.type === 'order' && entity.id && storeId) {
        const statusTriggers = await this.resolveOrderStatusTriggers(entity.id, storeId, sallaContent);

        this.logger.log(
          `🔍 order.status.updated → DB lookup → triggers: [${statusTriggers.join(', ')}]`,
          { entityId: entity.id, storeId },
        );

        return statusTriggers;
      }

      this.logger.warn(
        `⚠️ order.status.updated: entity missing or wrong type — using businessType as trigger`,
        { entity },
      );
      return ['order.status.updated'];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // خريطة: اسم سلة → اسم سلة + الـ alias المستخدم في قوالب رفيق
    // الترتيب مهم: الاسم الأصلي أولاً ثم الـ alias
    // إذا التاجر أنشأ قالبه بأي من الاسمين → يشتغل
    // ═══════════════════════════════════════════════════════════════════════════
    const TRIGGER_ALIAS_MAP: Record<string, string[]> = {
      // ─── طلب جديد ────────────────────────────────────────────────────────
      // سلة ترسل هذين النوعين عند إنشاء طلب جديد
      // التاجر يُنشئ قالبه بـ order.created (الاسم الشائع)
      'order.status.confirmation':  ['order.status.confirmation', 'order.created'],
      'order.notification.create':  ['order.notification.create', 'order.created'],

      // ─── استرجاع ─────────────────────────────────────────────────────────
      // سلة: order.refund.processed | رفيق preset: order.refunded
      'order.refund.processed':     ['order.refund.processed', 'order.refunded'],

      // ─── شحن ─────────────────────────────────────────────────────────────
      // سلة: order.shipment.created | رفيق preset: shipment.created
      'order.shipment.created':     ['order.shipment.created', 'shipment.created'],

      // ─── فاتورة ──────────────────────────────────────────────────────────
      // سلة: order.invoice.issued | رفيق preset: invoice.created
      'order.invoice.issued':       ['order.invoice.issued', 'invoice.created'],

      // ─── بانتظار الدفع ───────────────────────────────────────────────────
      // سلة: payment.reminder.due | رفيق preset: order.status.pending_payment
      'payment.reminder.due':       ['payment.reminder.due', 'order.status.pending_payment'],

      // ─── سلة متروكة ──────────────────────────────────────────────────────
      // سلة: customer.cart.abandoned | رفيق preset: abandoned.cart
      'customer.cart.abandoned':    ['customer.cart.abandoned', 'abandoned.cart'],

      // ─── إعادة توفر منتج ─────────────────────────────────────────────────
      // سلة: product.availability.alert | رفيق preset: product.available
      'product.availability.alert': ['product.availability.alert', 'product.available'],
    };

    // ─── بحث في الخريطة ──────────────────────────────────────────────────────
    const aliases = TRIGGER_ALIAS_MAP[businessType];
    if (aliases) {
      this.logger.log(
        `🗺️ Communication trigger mapped: "${businessType}" → [${aliases.join(', ')}]`,
      );
      return aliases;
    }

    // ─── باقي الأنواع: trigger = businessType نفسه ────────────────────────
    // customer.rating.request, customer.loyalty.earned, product.digital.code,
    // order.gift.placed, marketing.campaign.broadcast, system.*, etc.
    return [businessType];
  }

  /**
   * 📊 بناء متغيرات القالب من بيانات الكيان
   *
   * ✅ Draft 1 Entity Types:
   *   order    → DB lookup بـ sallaOrderId / referenceId → بيانات كاملة
   *   shipment → entity.id = shipment_id → استخرج من sallaContent
   *   cart     → entity.id = cart_id → استخرج من sallaContent
   *   product  → entity.id = product_id → استخرج من sallaContent
   *   feedback → entity.id = feedback_id → استخرج من sallaContent
   *   null     → جلب بيانات العميل من DB بـ customerId + استخرج من sallaContent
   */
  private async buildTemplateVariables(
    entity: { id: number; type: string } | null,
    storeId: string | undefined,
    sallaContent: string,
    businessType: string,
    customerId?: number,
    rawData?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {

    // ─── الخطوة 1: استخراج متغيرات من نص سلة (قاعدة للجميع) ─────────────────
    // يستخرج: reference_id, order_number, otp_code, customer_name
    const baseVars = this.extractVariablesFromSallaContent(sallaContent);

    // ─── الخطوة 2: جلب بيانات العميل من DB بـ customerId ─────────────────────
    // ✅ يعمل لجميع أنواع entity: order / shipment / cart / product / feedback / null
    // الهدف: customer_name, customer_phone, customer_email للقالب
    if (customerId && storeId) {
      try {
        const customer = await this.customerRepository.findOne({
          where: { sallaCustomerId: String(customerId), storeId },
          select: ['id', 'firstName', 'lastName', 'fullName', 'phone', 'email'],
        });

        if (customer) {
          const fullName = customer.fullName
            || [customer.firstName, customer.lastName].filter(Boolean).join(' ')
            || customer.firstName
            || 'عميلنا الكريم';

          baseVars.customer_name       = fullName;
          baseVars.customer_first_name = customer.firstName || fullName;
          baseVars.customer_phone      = customer.phone  || baseVars.customer_phone;
          baseVars.customer_email      = customer.email  || baseVars.customer_email;

          this.logger.debug(`👤 Customer enriched from DB: ${fullName} (sallaId=${customerId})`);
        } else {
          this.logger.debug(`⚠️ Customer not found in DB (sallaId=${customerId}) — using Salla content vars`);
        }
      } catch (err) {
        this.logger.warn(`⚠️ Customer DB lookup failed: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // ─── الخطوة 2.5: store_name — يُستخدم في أغلب القوالب ─────────────────
    if (!baseVars.store_name && rawData) {
      const meta = (rawData.meta || {}) as Record<string, unknown>;
      baseVars.store_name = meta.store_name || meta.merchant_name || meta.store || '';
    }
    if (!baseVars.store_name) {
      baseVars.store_name = 'متجرنا';
    }

    // ─── الخطوة 3: معالجة حسب entity.type ────────────────────────────────────

    // entity = null (loyalty / otp / system / marketing) → baseVars تكفي
    if (!entity?.id) {
      this.logger.debug(`📝 buildTemplateVariables [${businessType}]: no entity → baseVars only`);
      return baseVars;
    }

    const entityIdStr = String(entity.id);

    // ─── entity.type = 'order' → DB lookup كامل ────────────────────────────
    if (entity.type === 'order') {
      try {
        // البحث بـ sallaOrderId أولاً ثم referenceId
        let order = await this.orderRepository.findOne({
          where: { storeId, sallaOrderId: entityIdStr },
          relations: ['customer'],
        });

        if (!order) {
          order = await this.orderRepository.findOne({
            where: { storeId, referenceId: entityIdStr },
            relations: ['customer'],
          });
        }

        if (order) {
          // ✅ بيانات الطلب الكاملة من DB
          const customerFromOrder = order.customer;
          const customerName = customerFromOrder?.fullName
            || customerFromOrder?.firstName
            || String(baseVars.customer_name || 'عميلنا الكريم');

          this.logger.debug(`📦 Order found: ${order.sallaOrderId || order.referenceId} [${businessType}]`);

          return {
            // بيانات الطلب
            id:               order.sallaOrderId || order.id,
            reference_id:     order.referenceId  || order.sallaOrderId,
            order_id:         order.referenceId  || order.sallaOrderId,
            order_number:     order.referenceId  || order.sallaOrderId,
            status:           order.status,
            order_status:     order.status,
            total:            order.totalAmount,
            order_total:      order.totalAmount,
            order_date:       order.createdAt
                                ? new Date(order.createdAt).toLocaleDateString('ar-SA')
                                : new Date().toLocaleDateString('ar-SA'),
            // بيانات العميل (من customer relation أو من lookup السابق)
            customer: {
              first_name: customerFromOrder?.firstName || customerName,
              name:       customerName,
              mobile:     customerFromOrder?.phone || baseVars.customer_phone,
              email:      customerFromOrder?.email || baseVars.customer_email,
            },
            customer_name:        String(baseVars.customer_name || customerName),
            customer_first_name:  customerFromOrder?.firstName || customerName,
            customer_phone:       customerFromOrder?.phone  || String(baseVars.customer_phone || ''),
            customer_email:       customerFromOrder?.email  || String(baseVars.customer_email || ''),
            // بيانات الشحن
            tracking_number:      (order.metadata as any)?.trackingNumber  || (order.metadata as any)?.tracking_number,
            shipping_company:     (order.metadata as any)?.shippingCompany || (order.metadata as any)?.shipping_company,
            tracking_url:         (order.metadata as any)?.trackingUrl     || (order.metadata as any)?.tracking_url,
            order_tracking:       (order.metadata as any)?.trackingUrl     || (order.metadata as any)?.tracking_url,
            // روابط
            payment_link:         (order.metadata as any)?.paymentUrl      || (order.metadata as any)?.payment_url,
            store_name:           (order.metadata as any)?.storeName       || 'متجرنا',
          };

        } else {
          // الطلب غير موجود في DB → استخدم baseVars + entityId
          this.logger.warn(
            `⚠️ Order not found in DB (id=${entityIdStr}, storeId=${storeId}) [${businessType}]`,
          );
          baseVars.order_id     = entityIdStr;
          baseVars.reference_id = baseVars.reference_id || entityIdStr;
          baseVars.entity_id    = entityIdStr;
          return baseVars;
        }

      } catch (error) {
        this.logger.error(
          `❌ Order DB lookup failed [${businessType}]: ${error instanceof Error ? error.message : 'Unknown'}`,
        );
        baseVars.order_id  = entityIdStr;
        baseVars.entity_id = entityIdStr;
        return baseVars;
      }
    }

    // ─── entity.type = 'shipment' ─────────────────────────────────────────────
    if (entity.type === 'shipment') {
      baseVars.shipment_id  = entityIdStr;
      baseVars.entity_id    = entityIdStr;
      baseVars.entity_type  = 'shipment';
      // tracking_number قد يكون في sallaContent أو في baseVars
      if (!baseVars.tracking_number) {
        baseVars.tracking_number = entityIdStr;
      }
      this.logger.debug(`🚚 Shipment entity [${businessType}]: id=${entityIdStr}`);
      return baseVars;
    }

    // ─── entity.type = 'cart' ─────────────────────────────────────────────────
    if (entity.type === 'cart') {
      baseVars.cart_id      = entityIdStr;
      baseVars.entity_id    = entityIdStr;
      baseVars.entity_type  = 'cart';

      // ─── استخراج بيانات السلة من meta (Salla raw payload) ─────────────────
      const meta = (rawData?.meta || {}) as Record<string, unknown>;

      // cart_total: من meta أو من نص سلة
      const cartTotal = meta.cart_total || meta.total || meta.amount
        || meta.cart_amount || meta.sub_total;
      if (cartTotal !== undefined && cartTotal !== null) {
        baseVars.cart_total = cartTotal;
      } else {
        // حاول استخرج من نص سلة: "إجمالي السلة: 150 ريال" أو "بقيمة 150"
        const totalMatch = sallaContent.match(/(?:إجمالي|بقيمة|المبلغ|total)[:\s]*(\d[\d,.]*)/i);
        if (totalMatch) {
          baseVars.cart_total = totalMatch[1].replace(/,/g, '');
        }
      }

      // items_count: عدد المنتجات في السلة
      const itemsCount = meta.items_count || meta.products_count || meta.count;
      if (itemsCount) baseVars.cart_items_count = itemsCount;

      // cart_url: رابط السلة
      const cartUrl = meta.cart_url || meta.checkout_url || meta.url;
      if (cartUrl) {
        baseVars.cart_url     = cartUrl;
        baseVars.checkout_url = cartUrl;
      }

      // store_name: من meta أو من نص سلة
      if (!baseVars.store_name) {
        const storeName = meta.store_name || meta.merchant_name;
        if (storeName) {
          baseVars.store_name = storeName;
        } else {
          // حاول استخرج من نص سلة: "متجر اسم المتجر" أو نهاية النص
          const storeMatch = sallaContent.match(/(?:متجر|من\s+)([\u0600-\u06FF\w\s]+?)(?:[.!،\n]|$)/);
          if (storeMatch) baseVars.store_name = storeMatch[1].trim();
        }
      }

      // fallback: لو cart_total لسا فاضي
      if (!baseVars.cart_total) baseVars.cart_total = '';

      this.logger.debug(`🛒 Cart entity [${businessType}]: id=${entityIdStr}, total=${baseVars.cart_total || 'N/A'}`);
      return baseVars;
    }

    // ─── entity.type = 'product' ──────────────────────────────────────────────
    if (entity.type === 'product') {
      baseVars.product_id   = entityIdStr;
      baseVars.entity_id    = entityIdStr;
      baseVars.entity_type  = 'product';
      this.logger.debug(`📦 Product entity [${businessType}]: id=${entityIdStr}`);
      return baseVars;
    }

    // ─── entity.type = 'feedback' ─────────────────────────────────────────────
    if (entity.type === 'feedback') {
      baseVars.feedback_id  = entityIdStr;
      baseVars.review_id    = entityIdStr;
      baseVars.entity_id    = entityIdStr;
      baseVars.entity_type  = 'feedback';
      this.logger.debug(`⭐ Feedback entity [${businessType}]: id=${entityIdStr}`);
      return baseVars;
    }

    // ─── entity.type غير معروف → baseVars + entityId ─────────────────────────
    this.logger.warn(`⚠️ Unknown entity.type="${entity.type}" [${businessType}]`);
    baseVars.entity_id   = entityIdStr;
    baseVars.entity_type = entity.type;
    return baseVars;
  }


  /**
   * 📦 تحديد triggerEvent لـ order.status.updated بناءً على حالة الطلب في DB
   *
   * ✅ استراتيجية البحث (3 مستويات):
   * 1. البحث بـ sallaOrderId (الـ ID الداخلي من سلة)
   * 2. البحث بـ referenceId (رقم الطلب المعروض: 245225985)
   * 3. استخراج الحالة من نص سلة مباشرة كـ fallback نهائي
   */
  private async resolveOrderStatusTriggers(
    entityId: number | string,
    storeId: string | undefined,
    sallaContentText?: string,   // نص سلة للاستخراج عند فشل DB
  ): Promise<string[]> {
    if (!storeId || !entityId) {
      // محاولة أخيرة: استخرج من النص إذا توفر
      if (sallaContentText) {
        return this.extractTriggersFromSallaText(sallaContentText);
      }
      return ['order.status.updated'];
    }

    // ─── خريطة OrderStatus → triggerEvent ───────────────────────────────────
    // ✅ كل حالة لها trigger مستقل تماماً — لا تداخل بين أي حالتين
    // slugs مأخوذة من Salla API docs الرسمية (NewOrderStatus schema)
    // ─── خريطة DB status → triggerEvent ──────────────────────────────────────
    // القاعدة: كل DB status له trigger واحد فقط — لا aliases هنا
    // الترجمة slug→DB حدثت في mapSallaOrderStatus (salla-webhook.processor)
    // هنا فقط نقرأ الـ DB status ونُحدّد الـ trigger
    const STATUS_TRIGGER_MAP: Record<string, string> = {
      'processing':        'order.status.processing',
      'under_review':      'order.status.under_review',
      'restoring':         'order.status.restoring',
      'completed':         'order.status.completed',
      'in_transit':        'order.status.in_transit',
      'shipped':           'order.shipped',
      'delivered':         'order.delivered',
      'ready_to_ship':     'order.status.ready_to_ship',
      'pending_payment':   'order.status.pending_payment',
      'on_hold':           'order.status.on_hold',
      'cancelled':         'order.cancelled',
      'refunded':          'order.refunded',
      'paid':              'order.status.paid',
      'created':           'order.created',
    };

    try {
      const idStr = String(entityId);

      // ─── المستوى 1: البحث بـ sallaOrderId (الـ ID الداخلي) ──────────────
      let order = await this.orderRepository.findOne({
        where: { storeId, sallaOrderId: idStr },
        select: ['id', 'status', 'sallaOrderId', 'referenceId'],
      });

      // ─── المستوى 2: البحث بـ referenceId (رقم الطلب المعروض) ─────────────
      // سلة تُرسل entityId = الـ ID الداخلي (1729744036)
      // لكن DB قد يحفظ الطلب برقم المرجع (245225985)
      if (!order) {
        order = await this.orderRepository.findOne({
          where: { storeId, referenceId: idStr },
          select: ['id', 'status', 'sallaOrderId', 'referenceId'],
        });

        if (order) {
          this.logger.debug(
            `🔍 Order found by referenceId="${idStr}" (not sallaOrderId) → status=${order.status}`,
          );
        }
      }

      if (order?.status) {
        const status = order.status.toLowerCase();
        const trigger = STATUS_TRIGGER_MAP[status];

        if (trigger) {
          this.logger.debug(`🗺️ Order DB status="${status}" → trigger: ${trigger}`);
          return [trigger];
        }

        return [`order.status.${status}`];
      }

      // ─── المستوى 3: استخراج الحالة من نص سلة ───────────────────────────
      // لم نجد الطلب في DB — نقرأ الحالة من النص العربي المُرسَل من سلة
      // مثال: "تم تغيير حالة طلبك رقم 245225985 إلى جاري التوصيل"
      if (sallaContentText) {
        const textTriggers = this.extractTriggersFromSallaText(sallaContentText);
        if (textTriggers.length && textTriggers[0] !== 'order.status.updated') {
          this.logger.log(
            `📝 Order not in DB — extracted status from Salla text → [${textTriggers.join(', ')}]`,
            { entityId, storeId },
          );
          return textTriggers;
        }
      }

      this.logger.warn(
        `⚠️ Order not found in DB (sallaOrderId="${idStr}", referenceId="${idStr}") — fallback to Salla content`,
        { storeId },
      );
      return ['order.status.updated'];

    } catch (error) {
      this.logger.warn(
        `⚠️ Could not resolve order status triggers: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return ['order.status.updated'];
    }
  }

  /**
   * 📝 استخراج triggerEvent من النص العربي لسلة
   *
   * سلة ترسل جملة جاهزة مثل:
   * "تم تغيير حالة طلبك رقم 245225985 إلى جاري التوصيل"
   * "تم تغيير حالة طلبك رقم 245225985 إلى تم التوصيل"
   * "تم تغيير حالة طلبك رقم 245225985 إلى تم الشحن"
   */
  private extractTriggersFromSallaText(text: string): string[] {
    // ✅ كل حالة لها trigger واحد ثابت
    // الترجمة slug→trigger حدثت في mapStatusToSpecificEvent (مكان واحد فقط)
    // هنا نستخرج trigger من النص العربي فقط
    const TEXT_STATUS_MAP: Array<{ patterns: string[]; trigger: string }> = [
      // ─── التوصيل ─────────────────────────────────────────────────────────
      {
        patterns: ['جاري التوصيل', 'في الطريق إليك', 'قيد التوصيل', 'في الطريق'],
        trigger: 'order.status.in_transit',
      },
      {
        patterns: ['تم التوصيل', 'وصل الطلب', 'تم الاستلام', 'تم توصيل'],
        trigger: 'order.delivered',
      },
      // ─── الشحن ───────────────────────────────────────────────────────────
      {
        patterns: ['تم الشحن', 'تم إرسال', 'شُحن الطلب', 'تم شحن'],
        trigger: 'order.shipped',
      },
      {
        patterns: ['جاهز للشحن', 'جاهز للإرسال', 'استعداد للشحن'],
        trigger: 'order.status.ready_to_ship',
      },
      // ─── التنفيذ — قيد التنفيذ (in_progress) ────────────────────────────
      // ✅ يبحث عن كلا الاسمين: in_progress (جديد) و processing (قديم)
      {
        patterns: ['قيد التنفيذ', 'جاري التنفيذ', 'قيد المعالجة', 'جاري المعالجة', 'يُعالَج'],
        trigger: 'order.status.processing',
      },
      // ─── الإكمال — تم التنفيذ (completed) ────────────────────────────────
      // ✅ مختلف تماماً عن قيد التنفيذ
      {
        patterns: ['تم التنفيذ', 'تم الإكمال', 'اكتمل الطلب', 'تم إكمال', 'مكتمل', 'اكتمل'],
        trigger: 'order.status.completed',
      },
      // ─── المراجعة ────────────────────────────────────────────────────────
      {
        patterns: ['بانتظار المراجعة', 'قيد المراجعة', 'تحت المراجعة', 'تحت الفحص'],
        trigger: 'order.status.under_review',
      },
      // ─── الإلغاء ─────────────────────────────────────────────────────────
      {
        patterns: ['تم الإلغاء', 'ألغي الطلب', 'إلغاء الطلب', 'طلبك ملغي'],
        trigger: 'order.cancelled',
      },
      // ─── الاسترجاع ───────────────────────────────────────────────────────
      {
        patterns: ['قيد الاسترجاع', 'يتم إرجاع', 'قيد الإرجاع', 'تم الاسترجاع'],
        trigger: 'order.status.restoring',
      },
      // ─── الانتظار ────────────────────────────────────────────────────────
      {
        patterns: ['بانتظار الدفع', 'بإنتظار الدفع', 'في انتظار الدفع', 'لم يكتمل الدفع'],
        trigger: 'order.status.pending_payment',
      },
      // ─── الدفع ───────────────────────────────────────────────────────────
      {
        patterns: ['تم الدفع', 'تم تأكيد الدفع', 'اكتمل الدفع'],
        trigger: 'order.status.paid',
      },
      // ─── الإنشاء ─────────────────────────────────────────────────────────
      {
        patterns: ['طلب جديد', 'تم إنشاء طلب', 'تأكيد الطلب', 'تم تأكيد طلبك'],
        trigger: 'order.created',
      },
    ];

    const lowerText = text.toLowerCase();

    for (const { patterns, trigger } of TEXT_STATUS_MAP) {
      if (patterns.some(p => lowerText.includes(p.toLowerCase()))) {
        this.logger.log(`📝 Salla text matched: "${patterns[0]}" → trigger: ${trigger}`, {
          textPreview: text.substring(0, 80),
        });
        return [trigger];
      }
    }

    this.logger.warn(
      `⚠️ extractTriggersFromSallaText: no pattern matched — text: "${text.substring(0, 100)}"`,
    );
    return ['order.status.updated'];
  }

  /**
   * 📊 جلب بيانات الكيان لاستبدال متغيرات القالب
   *
   * ✅ DRAFT 1: خمسة أنواع entity مختلفة:
   *   order    → يبحث بـ sallaOrderId ثم referenceId
   *   shipment → entity.id = shipment_id (ليس order_id)
   *              يستخرج المتغيرات من sallaContent مباشرة (رقم الطلب موجود في النص)
   *   cart     → entity.id = cart_id — يستخرج من sallaContent
  /**
   * 📝 استخراج متغيرات القالب من نص سلة العربي\n   *\n   * سلة ترسل نصاً جاهزاً — نستخرج منه المتغيرات الضرورية لاستبدالها في القالب
   *
   * أنماط النصوص من الأمثلة الرسمية:
   *   "أصبحت حالة طلبك #218103278 [تم التنفيذ]"
   *   "تم تغيير حالة طلبك رقم 245225985 إلى جاري التوصيل"
   *   "كود التفعيل الخاص بك: 0000"
   */
  private extractVariablesFromSallaContent(content?: string): Record<string, unknown> {
    if (!content) return {};

    const result: Record<string, unknown> = {};

    // ─── استخراج رقم الطلب ───────────────────────────────────────────────────
    // "طلبك #218103278"  أو  "رقم 245225985"  أو  "طلب #12345678"
    const orderNumMatch = content.match(/(?:طلب[كم]?\s*#|رقم\s*#?)\s*(\d{6,12})/);
    if (orderNumMatch) {
      result.reference_id  = orderNumMatch[1];
      result.order_number  = orderNumMatch[1];
      result.id            = orderNumMatch[1];
    }

    // ─── استخراج OTP من نص سلة ───────────────────────────────────────────────
    // "كود التفعيل الخاص بك: 0000"
    const otpMatch = content.match(/(?:كود[^:]*|رمز[^:]*|OTP[^:]*|code[^:]*)[:\s]+(\d{4,8})/i);
    if (otpMatch) {
      result.otp_code = otpMatch[1];
      result.code     = otpMatch[1];
    }

    // ─── استخراج اسم العميل ──────────────────────────────────────────────────
    // "أهلاً [اسم العميل]"  أو  "مرحباً محمد"
    const nameMatch = content.match(/(?:أهلاً|مرحباً|عزيزنا)\s+([^\n,،]+)/);
    if (nameMatch) {
      result.customer_name = nameMatch[1].trim();
    }

    return result;
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
        if (businessType === CommunicationEventType.AUTH_OTP_VERIFICATION && otpCode) {
          // ✅ المسودة 1: auth.otp.verification → meta.code هو OTP من سلة — لا نولّد رمزاً جديداً
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

    // تحويل نص الرسالة إلى HTML احترافي مع لون يناسب الحدث
    const html = this.textToHtml(content, businessType);

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
   *
   * ✅ DRAFT 1: كل businessType له موضوع مستقل يعكس الحدث بدقة
   * ✅ يُضيف رقم الكيان (طلب / شحنة / منتج) حين يكون مناسباً
   *
   * Entity types حسب المسودة 1:
   *   order    → يُضيف رقم الطلب
   *   shipment → يُضيف رقم الشحنة
   *   product  → لا رقم (المنتج ليس له رقم مرجعي مُعرَّض)
   *   cart     → لا رقم
   *   feedback → لا رقم
   *   null     → لا رقم
   */
  private getEmailSubject(businessType: string, entity: { id: number; type: string } | null): string {

    // موضوع مخصص لكل نوع حدث — مستقل تماماً
    const SUBJECT_MAP: Record<string, string> = {
      // ── أحداث الطلبات ──────────────────────────────────────────────────────
      'order.status.confirmation':   'تأكيد طلبك الجديد',
      'order.status.updated':        'تحديث حالة طلبك',
      'order.invoice.issued':        'فاتورتك جاهزة',
      'order.shipment.created':      'طلبك في الطريق إليك 🚚',
      'order.refund.processed':      'تم استرداد مبلغ طلبك',
      'order.gift.placed':           'طلب هدية جديد 🎁',
      // ── المدفوعات ───────────────────────────────────────────────────────────
      'payment.reminder.due':        'تذكير: أتمم دفع طلبك',
      // ── المنتجات ────────────────────────────────────────────────────────────
      'product.availability.alert':  'المنتج عاد للمخزون ✅',
      'product.digital.code':        'كودك الرقمي جاهز 🔑',
      // ── العملاء ─────────────────────────────────────────────────────────────
      'customer.cart.abandoned':     'هل نسيت شيئاً في سلتك؟ 🛒',
      'customer.loyalty.earned':     'نقاط ولاء جديدة 🌟',
      'customer.feedback.reply':     'رد على تقييمك',
      'customer.rating.request':     'شاركنا رأيك في طلبك ⭐',
      // ── التسويق والنظام ─────────────────────────────────────────────────────
      'marketing.campaign.broadcast':'عرض خاص لك من المتجر 🎉',
      'auth.otp.verification':       'رمز التحقق الخاص بك',
      'system.alert.general':        'إشعار من المتجر',
      'system.message.custom':       'رسالة خاصة من المتجر',
    };

    const baseSubject = SUBJECT_MAP[businessType] ?? 'إشعار من المتجر';

    // ✅ DRAFT 1: أضف رقم الكيان فقط لـ entity.type = 'order' أو 'shipment'
    if (entity?.id) {
      if (entity.type === 'order')    return `${baseSubject} #${entity.id}`;
      if (entity.type === 'shipment') return `${baseSubject} — شحنة #${entity.id}`;
    }

    return baseSubject;
  }

  /**
   * تحويل نص سلة العربي إلى HTML احترافي
   *
   * ✅ كل businessType يحصل على تصميم مناسب للحدث
   * ✅ يدعم RTL، أسطر متعددة، ويُحافظ على تنسيق النص
   */
  private textToHtml(text: string, businessType?: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const lines = escaped.split('\n').map(l => l.trim()).filter(Boolean).join('<br>\n');

    // اختيار لون الهيدر حسب نوع الحدث
    const ACCENT_COLORS: Record<string, string> = {
      'order.status.confirmation':   '#16a34a',  // أخضر — تأكيد
      'order.status.updated':        '#2563eb',  // أزرق — تحديث
      'order.invoice.issued':        '#7c3aed',  // بنفسجي — فاتورة
      'order.shipment.created':      '#0891b2',  // سماوي — شحن
      'order.refund.processed':      '#dc2626',  // أحمر — استرداد
      'order.gift.placed':           '#ea580c',  // برتقالي — هدية
      'payment.reminder.due':        '#d97706',  // ذهبي — تذكير
      'product.availability.alert':  '#16a34a',  // أخضر — توفر
      'product.digital.code':        '#7c3aed',  // بنفسجي — رقمي
      'customer.cart.abandoned':     '#d97706',  // ذهبي — سلة
      'customer.loyalty.earned':     '#ea580c',  // برتقالي — ولاء
      'customer.feedback.reply':     '#2563eb',  // أزرق — تقييم
      'customer.rating.request':     '#0891b2',  // سماوي — تقييم
      'marketing.campaign.broadcast':'#7c3aed',  // بنفسجي — تسويق
      'auth.otp.verification':       '#16a34a',  // أخضر — OTP
      'system.alert.general':        '#6b7280',  // رمادي — نظام
      'system.message.custom':       '#6b7280',  // رمادي — مخصص
    };

    const accent = (businessType && ACCENT_COLORS[businessType]) ?? '#2563eb';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;
                      overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:${accent};padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:13px;opacity:0.85;letter-spacing:0.5px;">رفيق</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;direction:rtl;text-align:right;">
              <p style="margin:0;font-size:16px;line-height:1.9;color:#1f2937;">${lines}</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                تم الإرسال تلقائياً عبر منصة رفيق &bull; لا تردّ على هذا البريد
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
    // ─── DISPATCH DIAGNOSTIC (يظهر في كل مكالمة لـ dispatch) ──────────────
    if (tenantId) {
      const tplCount = await this.templateRepository.count({
        where: this.ACTIVE_STATUSES.map(s => ({
          tenantId, triggerEvent, status: s as any,
        })),
      });

      const ch    = await this.findActiveWhatsAppChannel(storeId, tenantId);
      const phone = this.extractCustomerPhone(raw);

      const diag: Record<string, unknown> = {
        trigger:   triggerEvent,
        tenantId,
        storeId:   storeId || '❌ MISSING',
        templates: tplCount > 0 ? `✅ ${tplCount}` : '❌ 0',
        whatsapp:  ch    ? `✅ ${ch.id}`   : '❌ no channel',
        phone:     phone ? `✅ ${phone}`   : '❌ no phone',
      };

      // ─── عند عدم وجود قالب: اعرض كل قوالب التاجر المفعّلة للتشخيص ─────────
      if (tplCount === 0) {
        const allTemplates = await this.templateRepository.find({
          where: { tenantId },
          select: ['id', 'name', 'triggerEvent', 'status'] as any,
          order: { updatedAt: 'DESC' } as any,
          take: 20,
        });

        diag['❌_reason']      = `لا يوجد قالب بـ triggerEvent="${triggerEvent}" وstatus=approved/active`;
        diag['tenant_templates'] = allTemplates.map((t: any) => ({
          name:    t.name,
          trigger: t.triggerEvent,
          status:  t.status,
        }));

        this.logger.warn(`🔍 DISPATCH FAIL [${triggerEvent}]`, diag);
      } else {
        this.logger.log(`🔍 DISPATCH OK [${triggerEvent}]`, diag);
      }
    } else {
      this.logger.warn(`🔍 DISPATCH FAIL: tenantId MISSING for trigger=${triggerEvent}`);
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
        where: this.ACTIVE_STATUSES.map(s => ({
          tenantId, triggerEvent, status: s as any,
        })),
      });

      // ✅ LOG level بدل DEBUG - لازم يظهر في الـ production logs
      this.logger.log(`📋 Templates found: ${templates.length} for trigger: ${triggerEvent}`, {
        tenantId,
        triggerEvent,
        templateNames: templates.map((t: MessageTemplate) => t.name),
      });

      if (templates.length === 0) {
        this.logger.warn(`⚠️ No active templates found for trigger: ${triggerEvent} (tenantId: ${tenantId})`);
        return;
      }

      // ✅ v21: Template Isolation — قالب واحد لكل trigger_event
      // كل trigger_event فريد من المصدر (Processor) → لا تعارض ممكن
      if (templates.length > 1) {
        this.logger.warn(`⚠️ ISOLATION: ${templates.length} templates share trigger "${triggerEvent}" — sending most recent only`, {
          templateNames: templates.map((t: MessageTemplate) => t.name),
        });
      }
      const activeTemplate = templates.sort(
        (a: MessageTemplate, b: MessageTemplate) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0),
      )[0];

      // 2️⃣ قناة واتساب
      const channel = await this.findActiveWhatsAppChannel(storeId, tenantId);
      if (!channel) {
        this.logger.warn(`⚠️ No active WhatsApp channel for store ${storeId} or tenant ${tenantId}`);
        return;
      }
      this.logger.log(`📱 WhatsApp channel found: ${channel.id} (type: ${channel.type})`);

      // 3️⃣ رقم الهاتف
      let customerPhone = this.extractCustomerPhone(raw);
      if (!customerPhone) {
        this.logger.log(`🔍 Phone not in webhook data, looking up from database...`);
        const directCustomerId = (raw.customerId || raw.customer_id) as number | undefined;
        customerPhone = await this.lookupCustomerPhone(raw, storeId, directCustomerId);
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

      // 4️⃣ إرسال القالب المفعّل
      const template     = activeTemplate;
      const sendSettings = template.sendSettings;
      const mode         = sendSettings?.sendingMode || SendingMode.INSTANT;

      if (mode === SendingMode.MANUAL) {
        this.logger.log(`⏭️ Skipping MANUAL template: "${template.name}"`);
        return;
      }

      // ✅ Delayed/Conditional مع تأخير: جدولة
      const delayMinutes = sendSettings?.delayMinutes;
      if (delayMinutes && delayMinutes > 0 && (mode === SendingMode.DELAYED || mode === SendingMode.CONDITIONAL)) {
        this.logger.log(`⏰ Scheduling: "${template.name}" → ${customerPhone} (delay: ${delayMinutes}min)`);
        const orderId = String(raw.id || raw.orderId || raw.order_id || '');
        await this.templateSchedulerService.scheduleDelayedSend({
          template, tenantId, storeId, customerPhone,
          customerName: String(
            (raw.customer as any)?.first_name ||
            (raw.customer as any)?.name ||
            raw.customerName || '',
          ),
          referenceId: orderId || undefined,
          referenceType: triggerEvent.split('.')[0] || undefined,
          triggerEvent, payload: raw, delayMinutes,
          sequenceGroupKey: sendSettings?.sequence?.groupKey,
          sequenceOrder:    sendSettings?.sequence?.order,
        });
        dedupConfirmed = true;
        return;
      }

      // ✅ Instant: إرسال فوري
      this.logger.log(`📤 Sending template: "${template.name}" for trigger: ${triggerEvent}`);
      const sendSuccess = await this.sendTemplate(template, channel, customerPhone, raw);
      if (sendSuccess) dedupConfirmed = true;

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
      // ✅ telephone fallback (زد يرسل telephone بدل mobile)
      if (customer.telephone) {
        this.logger.log(`📞 Phone found in customer.telephone: ${customer.telephone}`);
        return this.normalizePhone(String(customer.telephone));
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

    // 2. من الحقول المباشرة (top-level)
    // ✅ telephone مدعوم (زد يرسل telephone، سلة ترسل mobile)
    const directPhone = data.customerPhone || data.mobile || data.phone || data.telephone;
    if (directPhone) {
      // ✅ إذا mobile موجود بدون mobile_code → جرّب بناء الرقم الكامل من top-level
      const builtPhone = this.buildFullPhone(data);
      if (builtPhone && builtPhone !== String(directPhone)) {
        this.logger.log(`📞 Phone built from top-level mobile_code+mobile: ${builtPhone}`);
        return this.normalizePhone(builtPhone);
      }
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
  /**
   * جلب رقم العميل من قاعدة البيانات
   *
   * ✅ المسودة 1: أنواع الـ entity المختلفة تحتاج استراتيجيات مختلفة:
   *
   *   order / cart / shipment / product → يبحث عبر sallaOrderId
   *   feedback                          → يبحث عبر sallaCustomerId مباشرة
   *   null (customer.loyalty.earned,    → يبحث عبر sallaCustomerId مباشرة
   *          auth.otp.verification,       (customerId في meta)
   *          system.*, marketing.*)
   */
  private async lookupCustomerPhone(
    data: Record<string, unknown>,
    storeId?: string,
    directCustomerId?: number,  // ✅ FIX #6: للأحداث التي لا تحتوي entity
  ): Promise<string | null> {
    if (!storeId) return null;

    try {
      // ─── FIX #6: customer.loyalty.earned + أحداث بدون entity ─────────────
      // المسودة 1: هذه الأحداث لها customer_id في meta لكن لا entity
      // نبحث مباشرة بـ sallaCustomerId في جدول customers
      if (directCustomerId) {
        this.logger.log(`🔍 Looking up customer by sallaCustomerId: ${directCustomerId}, storeId: ${storeId}`);

        const customer = await this.customerRepository.findOne({
          where: { sallaCustomerId: String(directCustomerId), storeId },
          select: ['id', 'phone', 'sallaCustomerId'],
        });

        if (customer?.phone) {
          this.logger.log(`📞 Phone found via sallaCustomerId lookup: ${customer.phone}`);
          return this.normalizePhone(customer.phone);
        }

        this.logger.log(`🔍 Customer not found by sallaCustomerId: ${directCustomerId} — trying order lookup`);
      }

      // ─── البحث عبر orderId (الطريقة الأصلية) ─────────────────────────────
      const orderObj = data.order as Record<string, unknown> | undefined;
      const orderId = data.id || data.orderId || data.order_id || orderObj?.id || orderObj?.order_id;
      if (!orderId) {
        this.logger.log(`🔍 No order ID and no directCustomerId — cannot lookup phone`);
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

      // جلب الرقم من العميل المرتبط بالطلب
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
          this.logger.log(`📞 Phone found from customer direct lookup: ${customer.phone}`);
          return this.normalizePhone(customer.phone);
        }
      }

      // محاولة أخيرة: البحث في metadata.sallaData (الـ snapshot الأصلي من سلة)
      const sallaData = (order.metadata as any)?.sallaData as Record<string, unknown> | undefined;
      if (sallaData) {
        const sallaCustomer = sallaData.customer as Record<string, unknown> | undefined;

        if (sallaCustomer) {
          // ✅ FIX: استخدام buildFullPhone لبناء الرقم الكامل من mobile_code + mobile
          // الكود القديم: sallaCustomer.mobile فقط → رقم محلي بدون كود الدولة
          // الكود الجديد: mobile_code + mobile → رقم دولي كامل
          const builtPhone = this.buildFullPhone(sallaCustomer);
          if (builtPhone) {
            this.logger.log(`📞 Phone built from sallaData.customer (mobile_code+mobile): ${builtPhone}`);
            return this.normalizePhone(builtPhone);
          }
        }

        // Fallback: رقم مباشر في sallaData
        const directPhone = (sallaData as any).customer_phone;
        if (directPhone) {
          this.logger.log(`📞 Phone found from sallaData.customer_phone: ${directPhone}`);
          return this.normalizePhone(String(directPhone));
        }

        // Fallback: عنوان الشحن
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
  /**
   * ╔══════════════════════════════════════════════════════════════════════════════╗
   * ║  buildFullPhone — v2 PRODUCTION FIX                                          ║
   * ║                                                                              ║
   * ║  المشكلة الجذرية (تؤثر على طلب جديد + بانتظار المراجعة + بانتظار الدفع):  ║
   * ║  سلة ترسل: { mobile_code: "966", mobile: "0501234567" }                     ║
   * ║  الكود القديم:  "966" + "0501234567" = "9660501234567"  ← رقم خاطئ ❌      ║
   * ║  الكود الجديد: "966" + "501234567"  = "966501234567"   ← رقم صحيح ✅       ║
   * ║                                                                              ║
   * ║  القاعدة: عند وجود mobile_code → احذف الصفر البادئ من mobile               ║
   * ║           لأن mobile_code هو كود الدولة الكامل (966, 971, 1...)             ║
   * ║           والـ mobile يكون إما "0501234567" أو "501234567" — كلاهما مدعوم  ║
   * ╚══════════════════════════════════════════════════════════════════════════════╝
   */
  private buildFullPhone(obj: Record<string, unknown>): string | null {
    const mobileCode = obj.mobile_code || obj.country_code || obj.countryCode;
    const mobile = obj.mobile;

    // ─── حالة 1: mobile_code + mobile ────────────────────────────────────────
    if (mobileCode && mobile) {
      const code = String(mobileCode).replace(/[^0-9]/g, '');
      // ✅ FIX CRITICAL: إزالة الصفر البادئ من mobile عند وجود mobile_code
      // سلة ترسل mobile="0501234567" مع mobile_code="966"
      // بدون إزالة الصفر: "966" + "0501234567" = "9660501234567" ← خاطئ
      // مع إزالة الصفر:  "966" + "501234567"  = "966501234567"  ← صحيح
      const num = String(mobile).replace(/[^0-9]/g, '').replace(/^0+/, '');
      if (code && num) {
        this.logger.log(`📞 Built phone: mobile_code(${code}) + mobile(stripped=${num}) = ${code + num}`);
        return code + num;
      }
    }

    // ─── حالة 2: phone كامل (مثل "+966501234567") ────────────────────────────
    if (obj.phone) return String(obj.phone);

    // ─── حالة 3: mobile فقط بدون mobile_code ────────────────────────────────
    if (mobile) return String(mobile);

    return null;
  }

  /**
   * ╔══════════════════════════════════════════════════════════════════════════════╗
   * ║  normalizePhone — v2 PRODUCTION FIX                                          ║
   * ║                                                                              ║
   * ║  يعالج جميع الأشكال الواردة من سلة وDB:                                    ║
   * ║  • "+966501234567"   → "966501234567"   (إزالة +)                          ║
   * ║  • "966501234567"    → "966501234567"   (بدون تغيير)                       ║
   * ║  • "0501234567"      → "966501234567"   (سعودي بصفر)                       ║
   * ║  • "501234567"       → "966501234567"   (سعودي بدون صفر)                   ║
   * ║  • "9660501234567"   → "966501234567"   (ناتج buildFullPhone القديم)        ║
   * ╚══════════════════════════════════════════════════════════════════════════════╝
   */
  private normalizePhone(phone: string): string {
    if (!phone) return '';

    // ─── تنظيف: إزالة المسافات، الشرطات، الأقواس، وعلامة +
    let n = phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');

    // ─── إصلاح ناتج buildFullPhone القديم (تراكم صفر):
    // "9660501234567" (13 رقم) → "966501234567" (12 رقم صحيح)
    if (n.startsWith('9660') && n.length === 13) {
      n = '966' + n.slice(4);
    }

    // ─── أرقام سعودية محلية: 05XXXXXXXX → 966XXXXXXXX
    else if (n.startsWith('05') && n.length === 10) {
      n = '966' + n.slice(1);
    }

    // ─── أرقام سعودية بدون صفر: 5XXXXXXXX → 966XXXXXXXX
    else if (n.startsWith('5') && n.length === 9) {
      n = '966' + n;
    }

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
      customer_name: safeStr(customer.first_name || customer.name || data.customerName || data.first_name || (data.lastName ? String(data.firstName || "") : undefined), "عميلنا الكريم"),
      customer_first_name: safeStr(customer.first_name || data.customerName || data.first_name, "عميلنا"),
      customer_phone: safeStr(customer.mobile || customer.phone || data.mobile || data.phone || data.telephone),
      customer_email: safeStr(customer.email || data.email),
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
