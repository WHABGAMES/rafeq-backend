/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Salla Webhook Processor                          ║
 * ║                                                                                ║
 * ║  ✅ v5: Security & Stability Fixes                                             ║
 * ║  🔧 FIX #18: TS2538 Build Error - mapSallaOrderStatus type-safe               ║
 * ║  🔧 FIX H5: Salla status object crash - handles object/string/undefined       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SallaWebhooksService } from '../salla-webhooks.service';
import { WebhookStatus, SallaEventType } from '@database/entities/webhook-event.entity';
import { WebhookLogAction } from '../entities/webhook-log.entity';
import { Order, OrderStatus } from '@database/entities/order.entity';
import { Customer, CustomerStatus } from '@database/entities/customer.entity';

interface SallaWebhookJobData {
  webhookEventId: string;
  eventType: string;
  merchant: number;
  data: Record<string, unknown>;
  tenantId?: string;
  storeId?: string;
  isRetry?: boolean;
}

/**
 * 🔧 FIX H5: Interface لتعريف بنية status القادمة من سلة
 * سلة قد ترسل الحالة كـ string أو كـ object {id, name, slug, customized}
 */
interface SallaStatusObject {
  id?: number;
  name?: string;
  slug?: string;
  customized?: {
    id?: number;
    name?: string;
    slug?: string;
  };
}

/**
 * ✅ v11: تطبيع النص العربي مع Unicode NFC normalization
 * سلة قد ترسل "بإنتظار" أو "بانتظار" أو "بأنتظار" — كلها نفس المعنى
 * المشكلة: سلة ترسل Unicode decomposed (ا + ◌ٕ) بينما الكود يستخدم composed (إ)
 * الحل: NFC normalization أولاً ثم توحيد الهمزات
 */
function normalizeArabic(text: string): string {
  return text
    // ✅ CRITICAL: Unicode NFC normalization — يوحّد composed/decomposed forms
    .normalize('NFC')
    // إزالة التشكيل (فتحة، ضمة، كسرة، سكون، شدّة، تنوين، همزة تحتية/فوقية كـ combining)
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
    // توحيد الألف بجميع أشكالها → ا
    .replace(/[إأآٱءٵٲٳ]/g, 'ا')
    // توحيد التاء المربوطة والهاء
    .replace(/ة/g, 'ه')
    // توحيد الياء
    .replace(/ى/g, 'ي')
    // إزالة أي combining marks متبقية (Unicode category Mn)
    .replace(/[\u0300-\u036F\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED\uFE20-\uFE2F]/g, '')
    // إزالة zero-width characters و RTL/LTR marks
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    // إزالة المسافات الزائدة
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ✅ v16: تنظيف النص العربي للمقارنة بـ includes()
 * أخف من normalizeArabic — لا يوحّد الهمزات أو التاء المربوطة
 * فقط يزيل الأحرف المخفية التي تكسر includes()
 *
 * المشكلة: سلة ترسل نصوصاً تحتوي:
 *   - Zero-width joiner/non-joiner (U+200C, U+200D)
 *   - RTL/LTR marks (U+200E, U+200F, U+202A-U+202E)
 *   - Word joiner (U+2060)
 *   - BOM (U+FEFF)
 *   - Arabic tatweel (U+0640)
 *   - Combining marks
 *
 * هذه الأحرف تجعل "بإنتظار الدفع".includes("دفع") = false!
 */
function cleanForMatch(text: string): string {
  return text
    .normalize('NFC')
    // إزالة كل الأحرف المخفية + التشكيل + RTL marks
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')  // تشكيل
    .replace(/[\u0300-\u036F\uFE20-\uFE2F]/g, '')                      // combining marks
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')   // invisible chars
    .replace(/\u0640/g, '')                                              // tatweel
    .replace(/\s+/g, ' ')
    .trim();
}

@Processor('salla-webhooks', {
  concurrency: 10,
  limiter: { max: 100, duration: 1000 },
})
export class SallaWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(SallaWebhookProcessor.name);

  constructor(
    private readonly sallaWebhooksService: SallaWebhooksService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {
    super();
  }

  async process(job: Job<SallaWebhookJobData>): Promise<void> {
    const startTime = Date.now();
    const { webhookEventId, eventType, data, tenantId, storeId } = job.data;
    this.logger.log(`🔄 Processing webhook: ${eventType}`, { jobId: job.id, webhookEventId, attempt: job.attemptsMade + 1 });

    try {
      await this.sallaWebhooksService.updateStatus(webhookEventId, WebhookStatus.PROCESSING);
      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_STARTED, previousStatus: WebhookStatus.PENDING,
        newStatus: WebhookStatus.PROCESSING, attemptNumber: job.attemptsMade + 1,
      });

      const result = await this.handleEvent(eventType, data, { tenantId, storeId, webhookEventId });
      const dur = Date.now() - startTime;

      await this.sallaWebhooksService.updateStatus(webhookEventId, WebhookStatus.PROCESSED, { processingResult: result, processingDurationMs: dur });
      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSED, previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.PROCESSED, message: `Processed in ${dur}ms`, durationMs: dur, metadata: result,
      });
      this.eventEmitter.emit(`salla.${eventType}`, { webhookEventId, tenantId, storeId, data, result });
      this.logger.log(`✅ Webhook processed: ${eventType} in ${dur}ms`, { jobId: job.id, webhookEventId });
    } catch (error) {
      const dur = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`❌ Webhook failed: ${eventType}`, { jobId: job.id, webhookEventId, error: errorMessage });
      const attempts = await this.sallaWebhooksService.incrementAttempts(webhookEventId);
      await this.sallaWebhooksService.updateStatus(webhookEventId, WebhookStatus.FAILED, { errorMessage, processingDurationMs: dur });
      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_FAILED, previousStatus: WebhookStatus.PROCESSING, newStatus: WebhookStatus.FAILED,
        message: errorMessage, errorDetails: { stack: errorStack }, durationMs: dur, attemptNumber: attempts,
      });
      throw error;
    }
  }

  private async handleEvent(eventType: string, data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    switch (eventType) {
      case SallaEventType.ORDER_CREATED:          return this.handleOrderCreated(data, context);
      case SallaEventType.ORDER_STATUS_UPDATED:   return this.handleOrderStatusUpdated(data, context);
      case SallaEventType.ORDER_PAYMENT_UPDATED:  return this.handleOrderPaymentUpdated(data, context);
      case SallaEventType.ORDER_SHIPPED:          return this.handleOrderShipped(data, context);
      case SallaEventType.ORDER_DELIVERED:        return this.handleOrderDelivered(data, context);
      case SallaEventType.ORDER_CANCELLED:        return this.handleOrderCancelled(data, context);
      case SallaEventType.CUSTOMER_CREATED:       return this.handleCustomerCreated(data, context);
      case SallaEventType.CUSTOMER_UPDATED:       return this.handleCustomerUpdated(data, context);
      case SallaEventType.ABANDONED_CART:         return this.handleAbandonedCart(data, context);
      case SallaEventType.SHIPMENT_CREATED:       return this.handleShipmentCreated(data, context);
      case SallaEventType.TRACKING_REFRESHED:     return this.handleTrackingRefreshed(data, context);
      case SallaEventType.PRODUCT_AVAILABLE:      return this.handleProductAvailable(data, context);
      case SallaEventType.PRODUCT_QUANTITY_LOW:   return this.handleProductQuantityLow(data, context);
      case SallaEventType.REVIEW_ADDED:           return this.handleReviewAdded(data, context);
      case SallaEventType.APP_INSTALLED:          return this.handleAppInstalled(data, context);
      case SallaEventType.APP_UNINSTALLED:        return this.handleAppUninstalled(data, context);
      case SallaEventType.ORDER_REFUNDED:         return this.handleOrderRefunded(data, context);
      case SallaEventType.PRODUCT_CREATED:        return this.handleProductCreated(data, context);
      case SallaEventType.CUSTOMER_OTP_REQUEST:   return this.handleCustomerOtpRequest(data, context);
      case SallaEventType.INVOICE_CREATED:        return this.handleInvoiceCreated(data, context);
      default: this.logger.warn(`Unhandled event: ${eventType}`); return { handled: false, eventType };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🗄️ Database Sync
  // ═══════════════════════════════════════════════════════════════════════════════

  private async syncCustomerToDatabase(customerData: Record<string, unknown>, context: { tenantId?: string; storeId?: string }): Promise<Customer | null> {
    if (!context.storeId || !customerData?.id) { this.logger.warn('⚠️ Cannot sync customer: missing storeId or id'); return null; }
    const sallaCustomerId = String(customerData.id);
    try {
      let customer = await this.customerRepository.findOne({ where: { storeId: context.storeId, sallaCustomerId } });
      const firstName = (customerData.first_name as string) || (customerData.name as string) || undefined;
      const lastName = (customerData.last_name as string) || undefined;
      const fullName = firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined;
      const phone = (customerData.mobile as string) || (customerData.phone as string) || (customerData.mobile_code as string) || undefined;
      const email = (customerData.email as string) || undefined;

      if (customer) {
        if (firstName) customer.firstName = firstName;
        if (lastName) customer.lastName = lastName;
        if (fullName) customer.fullName = fullName;
        if (phone) customer.phone = phone;
        if (email) customer.email = email;
        customer.metadata = { ...(customer.metadata || {}), sallaData: customerData } as any;
        customer = await this.customerRepository.save(customer);
        this.logger.log(`🔄 Customer updated: ${sallaCustomerId} (${fullName || 'N/A'})`);
      } else {
        customer = this.customerRepository.create({
          tenantId: context.tenantId, storeId: context.storeId, sallaCustomerId,
          firstName, lastName, fullName, phone, email,
          status: CustomerStatus.ACTIVE, metadata: { sallaData: customerData } as any,
        });
        customer = await this.customerRepository.save(customer);
        this.logger.log(`✅ Customer saved: ${sallaCustomerId} (${fullName || 'N/A'}, phone: ${phone || 'N/A'})`);
      }
      return customer;
    } catch (error: unknown) {
      this.logger.error(`❌ Customer sync failed ${sallaCustomerId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  private async syncOrderToDatabase(orderData: Record<string, unknown>, context: { tenantId?: string; storeId?: string }, customerId?: string): Promise<Order | null> {
    if (!context.storeId || !orderData?.id) { this.logger.warn('⚠️ Cannot sync order: missing storeId or id'); return null; }
    const sallaOrderId = String(orderData.id);
    try {
      let order = await this.orderRepository.findOne({ where: { storeId: context.storeId, sallaOrderId } });
      const status = this.mapSallaOrderStatus(orderData.status);
      const items = Array.isArray(orderData.items)
        ? (orderData.items as Array<Record<string, unknown>>).map(item => ({
            productId: String(item.product_id || item.id || ''), name: String(item.name || ''),
            sku: (item.sku as string) || undefined, quantity: Number(item.quantity || 1),
            unitPrice: Number(item.price || item.unit_price || 0), totalPrice: Number(item.total || 0),
          }))
        : [];

      if (order) {
        order.status = status;
        if (customerId) order.customerId = customerId;
        order.referenceId = (orderData.reference_id as string) || (orderData.order_number as string) || order.referenceId;
        if (orderData.total) order.totalAmount = Number(orderData.total);
        if (items.length > 0) order.items = items as any;
        order.metadata = { ...(order.metadata || {}), sallaData: orderData } as any;
        order = await this.orderRepository.save(order);
        this.logger.log(`🔄 Order updated: ${sallaOrderId} → ${status}`);
      } else {
        order = this.orderRepository.create({
          tenantId: context.tenantId, storeId: context.storeId, customerId: customerId || undefined,
          sallaOrderId, referenceId: (orderData.reference_id as string) || (orderData.order_number as string) || undefined,
          status, currency: (orderData.currency as string) || 'SAR',
          totalAmount: Number(orderData.total || 0), subtotal: Number(orderData.sub_total || orderData.total || 0),
          items: items as any, metadata: { sallaData: orderData } as any,
        });
        order = await this.orderRepository.save(order);
        this.logger.log(`✅ Order saved: ${sallaOrderId} (${order.totalAmount} ${order.currency})`);
      }
      return order;
    } catch (error: unknown) {
      this.logger.error(`❌ Order sync failed ${sallaOrderId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  private async updateOrderStatusInDatabase(orderData: Record<string, unknown>, context: { tenantId?: string; storeId?: string }, newStatus: OrderStatus, extraUpdates?: Partial<Order>): Promise<Order | null> {
    if (!context.storeId || !orderData?.id) return null;
    const sallaOrderId = String(orderData.id);
    try {
      const order = await this.orderRepository.findOne({ where: { storeId: context.storeId, sallaOrderId } });
      if (!order) {
        this.logger.warn(`⚠️ Order ${sallaOrderId} not in DB - creating`);
        return this.syncOrderToDatabase({ ...orderData, status: newStatus }, context);
      }
      order.status = newStatus;
      if (extraUpdates) Object.assign(order, extraUpdates);
      order.metadata = { ...(order.metadata || {}), sallaData: { ...(order.metadata?.sallaData || {}), lastWebhookData: orderData } } as any;
      const saved = await this.orderRepository.save(order);
      this.logger.log(`🔄 Order ${sallaOrderId} → ${newStatus}`);
      return saved;
    } catch (error: unknown) {
      this.logger.error(`❌ Order status update failed ${sallaOrderId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  /**
   * 🔧 FIX #18 (TS2538) + H5: استخراج نص الحالة بأمان من أي نوع بيانات
   * سلة ترسل status بأشكال مختلفة:
   *   - string: "processing"
   *   - object: { id: 1, name: "قيد التنفيذ", slug: "processing", customized: {...} }
   *   - undefined/null
   */
  private extractStatusString(sallaStatus: unknown): string | undefined {
    if (!sallaStatus) return undefined;

    // إذا كانت string → نستخدمها مباشرة
    if (typeof sallaStatus === 'string') {
      return sallaStatus;
    }

    // إذا كانت object → نستخرج slug أو name
    if (typeof sallaStatus === 'object' && sallaStatus !== null) {
      const statusObj = sallaStatus as SallaStatusObject;

      // الأولوية: slug (إنجليزي) → customized.slug → name → customized.name
      if (statusObj.slug && typeof statusObj.slug === 'string') return statusObj.slug;
      if (statusObj.customized?.slug && typeof statusObj.customized.slug === 'string') return statusObj.customized.slug;
      if (statusObj.name && typeof statusObj.name === 'string') return statusObj.name;
      if (statusObj.customized?.name && typeof statusObj.customized.name === 'string') return statusObj.customized.name;
    }

    // إذا كانت number → نحولها لـ string
    if (typeof sallaStatus === 'number') {
      return String(sallaStatus);
    }

    this.logger.warn(`⚠️ Unexpected status type: ${typeof sallaStatus}`, { status: JSON.stringify(sallaStatus) });
    return undefined;
  }

  /**
   * 🔧 FIX #18 + H5 + Arabic normalization: تحويل حالة سلة → OrderStatus بشكل آمن
   * يقبل any type ويستخرج string قبل البحث في الخريطة
   * ✅ يستخدم normalizeArabic لضمان مطابقة "بإنتظار" = "بانتظار"
   */
  private mapSallaOrderStatus(sallaStatus: unknown): OrderStatus {
    const statusStr = this.extractStatusString(sallaStatus);
    if (!statusStr) return OrderStatus.CREATED;

    const s = statusStr.toLowerCase();

    // ═══════════════════════════════════════════════════════════════
    // 1. بحث إنجليزي مباشر (الأسرع والأكثر دقة)
    // ═══════════════════════════════════════════════════════════════
    const engMap: Record<string, OrderStatus> = {
      'created': OrderStatus.CREATED, 'new': OrderStatus.CREATED, 'pending': OrderStatus.CREATED,
      'processing': OrderStatus.PROCESSING, 'in_progress': OrderStatus.PROCESSING,
      'pending_payment': OrderStatus.PENDING_PAYMENT, 'paid': OrderStatus.PAID,
      'ready_to_ship': OrderStatus.READY_TO_SHIP, 'ready': OrderStatus.READY_TO_SHIP,
      'shipped': OrderStatus.SHIPPED, 'delivering': OrderStatus.SHIPPED,
      'in_transit': OrderStatus.SHIPPED, 'out_for_delivery': OrderStatus.SHIPPED,
      'delivered': OrderStatus.DELIVERED, 'completed': OrderStatus.COMPLETED,
      'cancelled': OrderStatus.CANCELLED, 'canceled': OrderStatus.CANCELLED,
      'refunded': OrderStatus.REFUNDED, 'failed': OrderStatus.FAILED, 'on_hold': OrderStatus.ON_HOLD,
      'restored': OrderStatus.PROCESSING, 'under_review': OrderStatus.PROCESSING,
      'awaiting_review': OrderStatus.PROCESSING, 'awaiting_payment': OrderStatus.PENDING_PAYMENT,
    };
    if (engMap[s]) return engMap[s];

    // ═══════════════════════════════════════════════════════════════
    // 2. ✅ v16 FIX: تنظيف Unicode المخفي قبل المطابقة العربية
    //    سلة ترسل أحرف مخفية (RTL marks, zero-width chars) تكسر includes()
    //    cleanForMatch يزيل هذه الأحرف لضمان المطابقة الصحيحة
    // ═══════════════════════════════════════════════════════════════
    const cleaned = cleanForMatch(statusStr);
    this.logger.debug(`🔍 Status cleaned: "${statusStr}" → "${cleaned}" (raw chars: ${statusStr.length}, cleaned: ${cleaned.length})`);

    const rawChecks: Array<{ test: (t: string) => boolean; status: OrderStatus; label: string }> = [
      // ✅ "مدفوع" يجب أن يُفحص قبل "دفع" لأن "مدفوع" تحتوي "دفع"
      { test: t => t.includes('مدفوع'), status: OrderStatus.PAID, label: 'مدفوع→PAID' },
      // ✅ "تم التنفيذ" / "مكتمل" يجب أن يُفحص قبل "تنفيذ" العام
      { test: t => t.includes('تم') && t.includes('تنفيذ'), status: OrderStatus.COMPLETED, label: 'تم+تنفيذ→COMPLETED' },
      { test: t => t.includes('مكتمل'), status: OrderStatus.COMPLETED, label: 'مكتمل→COMPLETED' },
      // ✅ "تم التوصيل" يُفحص قبل "توصيل" العام
      { test: t => t.includes('تم') && t.includes('توصيل'), status: OrderStatus.DELIVERED, label: 'تم+توصيل→DELIVERED' },
      // ✅ بانتظار الدفع — الكلمة المميزة "دفع" بدون "مدفوع"
      { test: t => t.includes('دفع') && !t.includes('مدفوع'), status: OrderStatus.PENDING_PAYMENT, label: 'دفع→PENDING_PAYMENT' },
      // ✅ بانتظار المراجعة — DB status = PROCESSING (لا يوجد UNDER_REVIEW في الـ enum)
      { test: t => t.includes('مراجع'), status: OrderStatus.PROCESSING, label: 'مراجع→PROCESSING' },
      // ✅ قيد التنفيذ / قيد المعالجة
      { test: t => t.includes('تنفيذ'), status: OrderStatus.PROCESSING, label: 'تنفيذ→PROCESSING' },
      { test: t => t.includes('معالج'), status: OrderStatus.PROCESSING, label: 'معالج→PROCESSING' },
      // ✅ الشحن والتوصيل
      { test: t => t.includes('جاهز') && t.includes('شحن'), status: OrderStatus.READY_TO_SHIP, label: 'جاهز+شحن→READY_TO_SHIP' },
      { test: t => t.includes('تم') && t.includes('شحن'), status: OrderStatus.SHIPPED, label: 'تم+شحن→SHIPPED' },
      { test: t => t.includes('جاري') && t.includes('توصيل'), status: OrderStatus.SHIPPED, label: 'جاري+توصيل→SHIPPED' },
      { test: t => t.includes('قيد') && t.includes('توصيل'), status: OrderStatus.SHIPPED, label: 'قيد+توصيل→SHIPPED' },
      // ✅ الإلغاء والاسترجاع
      { test: t => t.includes('ملغ'), status: OrderStatus.CANCELLED, label: 'ملغ→CANCELLED' },
      { test: t => t.includes('مسترجع'), status: OrderStatus.REFUNDED, label: 'مسترجع→REFUNDED' },
      { test: t => t.includes('سترجاع'), status: OrderStatus.REFUNDED, label: 'سترجاع→REFUNDED' },
      { test: t => t.includes('مستعاد'), status: OrderStatus.PROCESSING, label: 'مستعاد→PROCESSING' },
      // ✅ حالات أخرى
      { test: t => t.includes('معلق'), status: OrderStatus.ON_HOLD, label: 'معلق→ON_HOLD' },
      { test: t => t.includes('فشل'), status: OrderStatus.FAILED, label: 'فشل→FAILED' },
      { test: t => t.includes('جديد'), status: OrderStatus.CREATED, label: 'جديد→CREATED' },
    ];

    // ✅ v16: استخدام cleaned (بدون Unicode مخفي) بدل statusStr الخام
    for (const check of rawChecks) {
      if (check.test(cleaned)) {
        this.logger.log(`🎯 RAW keyword match: "${statusStr}" → ${check.label}`);
        return check.status;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. Fallback: normalizeArabic (احتياطي فقط)
    // ═══════════════════════════════════════════════════════════════
    const normalized = normalizeArabic(statusStr);
    const arMap: Record<string, OrderStatus> = {
      [normalizeArabic('جديد')]: OrderStatus.CREATED,
      [normalizeArabic('قيد التنفيذ')]: OrderStatus.PROCESSING,
      [normalizeArabic('قيد المعالجة')]: OrderStatus.PROCESSING,
      [normalizeArabic('بانتظار الدفع')]: OrderStatus.PENDING_PAYMENT,
      [normalizeArabic('بإنتظار الدفع')]: OrderStatus.PENDING_PAYMENT,
      [normalizeArabic('مدفوع')]: OrderStatus.PAID,
      [normalizeArabic('جاهز للشحن')]: OrderStatus.READY_TO_SHIP,
      [normalizeArabic('تم الشحن')]: OrderStatus.SHIPPED,
      [normalizeArabic('قيد التوصيل')]: OrderStatus.SHIPPED,
      [normalizeArabic('جاري التوصيل')]: OrderStatus.SHIPPED,
      [normalizeArabic('تم التوصيل')]: OrderStatus.DELIVERED,
      [normalizeArabic('مكتمل')]: OrderStatus.COMPLETED,
      [normalizeArabic('تم التنفيذ')]: OrderStatus.COMPLETED,
      [normalizeArabic('ملغي')]: OrderStatus.CANCELLED,
      [normalizeArabic('مسترجع')]: OrderStatus.REFUNDED,
      [normalizeArabic('فشل')]: OrderStatus.FAILED,
      [normalizeArabic('معلق')]: OrderStatus.ON_HOLD,
      [normalizeArabic('مستعاد')]: OrderStatus.PROCESSING,
      [normalizeArabic('بانتظار المراجعة')]: OrderStatus.PROCESSING,
      [normalizeArabic('بإنتظار المراجعة')]: OrderStatus.PROCESSING,
      [normalizeArabic('قيد الاسترجاع')]: OrderStatus.REFUNDED,
    };
    if (arMap[normalized]) return arMap[normalized];

    this.logger.warn(`⚠️ Unknown status: "${statusStr}" (cleaned: "${cleaned}", normalized: "${normalized}", rawChars: [${[...statusStr].map(c => 'U+' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(',')}]) → defaulting to PROCESSING`);
    return OrderStatus.PROCESSING;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Order Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleOrderCreated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.created', { orderId: data.id, storeId: context.storeId });
    let savedCustomer: Customer | null = null;
    const cd = data.customer as Record<string, unknown> | undefined;
    if (cd?.id) savedCustomer = await this.syncCustomerToDatabase(cd, context);
    const savedOrder = await this.syncOrderToDatabase(data, context, savedCustomer?.id);

    this.eventEmitter.emit('order.created', {
      tenantId: context.tenantId, storeId: context.storeId, orderId: data.id,
      orderNumber: data.reference_id || data.order_number,
      customerName: cd?.first_name || cd?.name, customerPhone: cd?.mobile || cd?.phone,
      totalAmount: data.total, currency: data.currency, items: data.items, status: data.status,
      raw: data, dbOrderId: savedOrder?.id, dbCustomerId: savedCustomer?.id,
    });
    return { handled: true, action: 'order_created', orderId: data.id, dbOrderId: savedOrder?.id || 'sync_failed', dbCustomerId: savedCustomer?.id || 'no_customer', emittedEvent: 'order.created' };
  }

  private async handleOrderStatusUpdated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    // ✅ v9: LOG كامل لبيانات الحالة
    this.logger.log('📦 order.status.updated RAW:', {
      orderId: data.id,
      status_type: typeof data.status,
      status_raw: JSON.stringify(data.status),
    });

    // 1. حفظ الحالة في DB (يستخدم system slug)
    const newStatus = this.mapSallaOrderStatus(data.status);
    await this.updateOrderStatusInDatabase(data, context, newStatus);

    // 2. مزامنة العميل
    const orderObj = data.order as Record<string, unknown> | undefined;
    const customerData = (data.customer || orderObj?.customer) as Record<string, unknown> | undefined;
    if (customerData?.id) {
      await this.syncCustomerToDatabase(customerData, context);
    }

    // 3. ✅ v9 CRITICAL FIX: استخراج الحالة الفعلية (customized أولاً) لاختيار القالب
    //    سلة ترسل: { slug: "in_progress", customized: { slug: "under_review" } }
    //    extractStatusString يرجع "in_progress" → قالب غلط ❌
    //    extractCustomizedStatus يرجع "under_review" → القالب الصحيح ✅
    const templateSlug = this.extractCustomizedStatus(data.status);
    const specificEvent = this.mapStatusToSpecificEvent(templateSlug, newStatus);

    this.logger.log('🔄 Status mapping:', {
      templateSlug,
      dbStatus: newStatus,
      specificEvent: specificEvent || 'NONE',
    });

    const eventPayload = { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, newStatus: data.status, previousStatus: data.previous_status, raw: data };

    if (specificEvent) {
      this.logger.log(`📌 Emitting ONLY: ${specificEvent}`);
      this.eventEmitter.emit(specificEvent, eventPayload);
    } else {
      this.logger.warn(`⚠️ No event for slug "${templateSlug}" (db: ${newStatus}) - no template sent`);
    }

    return { handled: true, action: 'order_status_updated', orderId: data.id, dbStatus: newStatus, templateSlug, specificEvent: specificEvent || 'NONE' };
  }

  /**
   * ✅ v9: استخراج الحالة المخصصة (customized) لاختيار القالب الصحيح
   *
   * الفرق عن extractStatusString:
   * - extractStatusString → slug أولاً (للـ DB)
   * - extractCustomizedStatus → customized.slug أولاً (للقوالب)
   *
   * مثال: التاجر اختار "بانتظار المراجعة":
   *   سلة ترسل: { slug: "in_progress", customized: { slug: "under_review" } }
   *   extractStatusString      → "in_progress"   → order.status.processing ❌
   *   extractCustomizedStatus  → "under_review"   → order.status.under_review ✅
   */
  private extractCustomizedStatus(sallaStatus: unknown): string {
    if (!sallaStatus) return '';
    if (typeof sallaStatus === 'string') return cleanForMatch(sallaStatus.toLowerCase());

    if (typeof sallaStatus === 'object' && sallaStatus !== null) {
      const obj = sallaStatus as SallaStatusObject;

      // 🔍 LOG: طباعة كل القيم
      this.logger.log('🔍 Salla status object:', {
        slug: obj.slug,
        name: obj.name,
        customized_slug: obj.customized?.slug,
        customized_name: obj.customized?.name,
      });

      // ✅ الأولوية: customized.slug → slug → customized.name → name
      if (obj.customized?.slug && typeof obj.customized.slug === 'string') return obj.customized.slug.toLowerCase();
      if (obj.slug && typeof obj.slug === 'string') return obj.slug.toLowerCase();
      if (obj.customized?.name && typeof obj.customized.name === 'string') return cleanForMatch(obj.customized.name);
      if (obj.name && typeof obj.name === 'string') return cleanForMatch(obj.name);
    }

    if (typeof sallaStatus === 'number') return String(sallaStatus);
    return '';
  }

  /**
   * ✅ v10: ربط حالة سلة → event خاص للقالب
   * يستخدم normalizeArabic لمطابقة "بإنتظار" = "بانتظار" وكل اختلافات الهمزات
   */
  private mapStatusToSpecificEvent(statusSlug: string, dbStatus: OrderStatus): string | null {
    // ═══════════════════════════════════════════════════════════════
    // 1. بحث إنجليزي مباشر (slug من سلة)
    // ═══════════════════════════════════════════════════════════════
    const slugMap: Record<string, string> = {
      'created': 'order.created',
      'new': 'order.created',
      'pending': 'order.created',
      'processing': 'order.status.processing',
      'in_progress': 'order.status.processing',
      'under_review': 'order.status.under_review',
      'awaiting_review': 'order.status.under_review',
      'completed': 'order.status.completed',
      'in_transit': 'order.status.in_transit',
      'out_for_delivery': 'order.status.in_transit',
      'delivering': 'order.status.in_transit',
      'shipped': 'order.status.shipped',
      'ready_to_ship': 'order.status.ready_to_ship',
      'ready': 'order.status.ready_to_ship',
      'pending_payment': 'order.status.pending_payment',
      'awaiting_payment': 'order.status.pending_payment',
      'paid': 'order.status.paid',
      'cancelled': 'order.status.cancelled',
      'canceled': 'order.status.cancelled',
      'refunded': 'order.status.refunded',
      'delivered': 'order.status.delivered',
      'restoring': 'order.status.restoring',
      'restored': 'order.status.restoring',
      'on_hold': 'order.status.on_hold',
    };
    if (slugMap[statusSlug]) return slugMap[statusSlug];

    // ═══════════════════════════════════════════════════════════════
    // 2. ✅ v16 FIX: تنظيف Unicode المخفي قبل المطابقة العربية
    //    نفس الإصلاح كـ mapSallaOrderStatus — cleanForMatch يزيل الأحرف المخفية
    // ═══════════════════════════════════════════════════════════════
    const cleaned = cleanForMatch(statusSlug);

    const rawEventChecks: Array<{ test: (t: string) => boolean; event: string; label: string }> = [
      // ✅ "مدفوع" قبل "دفع" لأن "مدفوع" تحتوي على "دفع"
      { test: t => t.includes('مدفوع'), event: 'order.status.paid', label: 'مدفوع→paid' },
      // ✅ "تم التنفيذ" / "مكتمل" قبل "تنفيذ" العام
      { test: t => t.includes('تم') && t.includes('تنفيذ'), event: 'order.status.completed', label: 'تم+تنفيذ→completed' },
      { test: t => t.includes('مكتمل'), event: 'order.status.completed', label: 'مكتمل→completed' },
      // ✅ "تم التوصيل" قبل "توصيل" العام
      { test: t => t.includes('تم') && t.includes('توصيل'), event: 'order.status.delivered', label: 'تم+توصيل→delivered' },
      // ✅ بانتظار الدفع — "دفع" بدون "مدفوع"
      { test: t => t.includes('دفع') && !t.includes('مدفوع'), event: 'order.status.pending_payment', label: 'دفع→pending_payment' },
      // ✅ بانتظار المراجعة — event مختلف عن DB status!
      { test: t => t.includes('مراجع'), event: 'order.status.under_review', label: 'مراجع→under_review' },
      // ✅ قيد التنفيذ / قيد المعالجة
      { test: t => t.includes('تنفيذ'), event: 'order.status.processing', label: 'تنفيذ→processing' },
      { test: t => t.includes('معالج'), event: 'order.status.processing', label: 'معالج→processing' },
      // ✅ الشحن والتوصيل
      { test: t => t.includes('جاهز') && t.includes('شحن'), event: 'order.status.ready_to_ship', label: 'جاهز+شحن→ready_to_ship' },
      { test: t => t.includes('تم') && t.includes('شحن'), event: 'order.status.shipped', label: 'تم+شحن→shipped' },
      { test: t => t.includes('جاري') && t.includes('توصيل'), event: 'order.status.in_transit', label: 'جاري+توصيل→in_transit' },
      { test: t => t.includes('قيد') && t.includes('توصيل'), event: 'order.status.in_transit', label: 'قيد+توصيل→in_transit' },
      // ✅ الإلغاء والاسترجاع
      { test: t => t.includes('ملغ'), event: 'order.status.cancelled', label: 'ملغ→cancelled' },
      { test: t => t.includes('مسترجع'), event: 'order.status.refunded', label: 'مسترجع→refunded' },
      { test: t => t.includes('سترجاع'), event: 'order.status.restoring', label: 'سترجاع→restoring' },
      { test: t => t.includes('مستعاد'), event: 'order.status.restoring', label: 'مستعاد→restoring' },
      // ✅ حالات أخرى
      { test: t => t.includes('معلق'), event: 'order.status.on_hold', label: 'معلق→on_hold' },
      { test: t => t.includes('جديد'), event: 'order.created', label: 'جديد→created' },
    ];

    // ✅ v16: استخدام cleaned بدل statusSlug الخام
    for (const check of rawEventChecks) {
      if (check.test(cleaned)) {
        this.logger.log(`🎯 RAW event match: "${statusSlug}" → ${check.label}`);
        return check.event;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. Fallback: normalizeArabic (احتياطي)
    // ═══════════════════════════════════════════════════════════════
    const normalizedSlug = normalizeArabic(statusSlug);
    const arMap: Record<string, string> = {
      [normalizeArabic('جديد')]: 'order.created',
      [normalizeArabic('قيد التنفيذ')]: 'order.status.processing',
      [normalizeArabic('قيد المعالجة')]: 'order.status.processing',
      [normalizeArabic('بانتظار المراجعة')]: 'order.status.under_review',
      [normalizeArabic('بإنتظار المراجعة')]: 'order.status.under_review',
      [normalizeArabic('تم التنفيذ')]: 'order.status.completed',
      [normalizeArabic('مكتمل')]: 'order.status.completed',
      [normalizeArabic('جاري التوصيل')]: 'order.status.in_transit',
      [normalizeArabic('قيد التوصيل')]: 'order.status.in_transit',
      [normalizeArabic('تم الشحن')]: 'order.status.shipped',
      [normalizeArabic('جاهز للشحن')]: 'order.status.ready_to_ship',
      [normalizeArabic('بانتظار الدفع')]: 'order.status.pending_payment',
      [normalizeArabic('بإنتظار الدفع')]: 'order.status.pending_payment',
      [normalizeArabic('مدفوع')]: 'order.status.paid',
      [normalizeArabic('تم التوصيل')]: 'order.status.delivered',
      [normalizeArabic('ملغي')]: 'order.status.cancelled',
      [normalizeArabic('مسترجع')]: 'order.status.refunded',
      [normalizeArabic('قيد الاسترجاع')]: 'order.status.restoring',
      [normalizeArabic('مستعاد')]: 'order.status.restoring',
      [normalizeArabic('معلق')]: 'order.status.on_hold',
    };
    if (arMap[normalizedSlug]) return arMap[normalizedSlug];

    // ═══════════════════════════════════════════════════════════════
    // 4. Last resort: من DB status
    // ═══════════════════════════════════════════════════════════════
    const dbMap: Record<string, string> = {
      [OrderStatus.CREATED]: 'order.created',
      [OrderStatus.PROCESSING]: 'order.status.processing',
      [OrderStatus.SHIPPED]: 'order.status.shipped',
      [OrderStatus.DELIVERED]: 'order.status.delivered',
      [OrderStatus.COMPLETED]: 'order.status.completed',
      [OrderStatus.READY_TO_SHIP]: 'order.status.ready_to_ship',
      [OrderStatus.PENDING_PAYMENT]: 'order.status.pending_payment',
      [OrderStatus.PAID]: 'order.status.paid',
      [OrderStatus.CANCELLED]: 'order.status.cancelled',
      [OrderStatus.REFUNDED]: 'order.status.refunded',
      [OrderStatus.ON_HOLD]: 'order.status.on_hold',
    };
    return dbMap[dbStatus] || null;
  }

  private async handleOrderPaymentUpdated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.payment.updated', { orderId: data.id });
    if (context.storeId && data.id) {
      try {
        const order = await this.orderRepository.findOne({ where: { storeId: context.storeId, sallaOrderId: String(data.id) } });
        if (order) {
          const pd = data.payment as Record<string, unknown>;
          if (pd?.status === 'paid') order.paymentStatus = 'paid' as any;
          order.metadata = { ...(order.metadata || {}), sallaData: { ...(order.metadata?.sallaData || {}), lastPaymentWebhook: data } } as any;
          await this.orderRepository.save(order);
          this.logger.log(`🔄 Order ${data.id} payment updated`);
        }
      } catch { this.logger.warn(`⚠️ Payment update failed for ${data.id}`); }
    }
    this.eventEmitter.emit('order.payment.updated', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, paymentStatus: (data.payment as Record<string, unknown>)?.status || data.payment_status, paymentMethod: (data.payment as Record<string, unknown>)?.method || data.payment_method, raw: data });
    return { handled: true, action: 'order_payment_updated', orderId: data.id, emittedEvent: 'order.payment.updated' };
  }

  private async handleOrderShipped(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.shipped', { orderId: data.id });
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.SHIPPED, { shippedAt: new Date() });
    this.eventEmitter.emit('order.shipped', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, trackingNumber: data.tracking_number, shippingCompany: data.shipping_company, raw: data });
    return { handled: true, action: 'order_shipped', orderId: data.id, emittedEvent: 'order.shipped' };
  }

  private async handleOrderDelivered(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.delivered', { orderId: data.id });
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.DELIVERED, { deliveredAt: new Date() });
    this.eventEmitter.emit('order.delivered', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, raw: data });
    return { handled: true, action: 'order_delivered', orderId: data.id, emittedEvent: 'order.delivered' };
  }

  private async handleOrderCancelled(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.cancelled', { orderId: data.id });
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.CANCELLED, { cancelledAt: new Date() });
    this.eventEmitter.emit('order.cancelled', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, cancelReason: data.cancel_reason, raw: data });
    return { handled: true, action: 'order_cancelled', orderId: data.id, emittedEvent: 'order.cancelled' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customer Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleCustomerCreated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.created', { customerId: data.id });
    const saved = await this.syncCustomerToDatabase(data, context);
    this.eventEmitter.emit('customer.created', { tenantId: context.tenantId, storeId: context.storeId, customerId: data.id, firstName: data.first_name, lastName: data.last_name, email: data.email, mobile: data.mobile, raw: data, dbCustomerId: saved?.id });
    return { handled: true, action: 'customer_created', customerId: data.id, dbCustomerId: saved?.id || 'sync_failed', emittedEvent: 'customer.created' };
  }

  private async handleCustomerUpdated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.updated', { customerId: data.id });
    await this.syncCustomerToDatabase(data, context);
    this.eventEmitter.emit('customer.updated', { tenantId: context.tenantId, storeId: context.storeId, customerId: data.id, raw: data });
    return { handled: true, action: 'customer_updated', customerId: data.id, emittedEvent: 'customer.updated' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Cart / 📦 Shipment / Product / Review / App / Extra
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleAbandonedCart(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing abandoned.cart', { cartId: data.id });
    const cd = data.customer as Record<string, unknown> | undefined;
    if (cd?.id) await this.syncCustomerToDatabase(cd, context);
    this.eventEmitter.emit('cart.abandoned', { tenantId: context.tenantId, storeId: context.storeId, cartId: data.id, customerName: cd?.first_name, customerPhone: cd?.mobile, customerEmail: cd?.email, cartTotal: data.total, items: data.items, raw: data });
    return { handled: true, action: 'abandoned_cart', cartId: data.id, emittedEvent: 'cart.abandoned' };
  }

  private async handleShipmentCreated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing shipment.created', { shipmentId: data.id });
    this.eventEmitter.emit('shipment.created', { tenantId: context.tenantId, storeId: context.storeId, shipmentId: data.id, orderId: data.order_id, trackingNumber: data.tracking_number, shippingCompany: data.shipping_company, raw: data });
    return { handled: true, action: 'shipment_created', shipmentId: data.id, emittedEvent: 'shipment.created' };
  }

  private async handleTrackingRefreshed(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing tracking.refreshed', { orderId: data.id });
    this.eventEmitter.emit('tracking.refreshed', { tenantId: context.tenantId, storeId: context.storeId, shipmentId: data.id, trackingStatus: data.status, raw: data });
    return { handled: true, action: 'tracking_refreshed', shipmentId: data.id, emittedEvent: 'tracking.refreshed' };
  }

  private async handleProductAvailable(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.available', { productId: data.id });
    this.eventEmitter.emit('product.available', { tenantId: context.tenantId, storeId: context.storeId, productId: data.id, productName: data.name, quantity: data.quantity, raw: data });
    return { handled: true, action: 'product_available', productId: data.id, emittedEvent: 'product.available' };
  }

  private async handleProductQuantityLow(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('⚠️ Processing product.quantity.low', { productId: data.id, quantity: data.quantity });
    this.eventEmitter.emit('product.quantity.low', { tenantId: context.tenantId, storeId: context.storeId, productId: data.id, productName: data.name, currentQuantity: data.quantity, raw: data });
    return { handled: true, action: 'product_quantity_low', productId: data.id, quantity: data.quantity, emittedEvent: 'product.quantity.low' };
  }

  private async handleReviewAdded(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing review.added', { reviewId: data.id });
    this.eventEmitter.emit('review.added', { tenantId: context.tenantId, storeId: context.storeId, reviewId: data.id, productId: data.product_id, rating: data.rating, content: data.content, customerName: data.customer_name, raw: data });
    return { handled: true, action: 'review_added', reviewId: data.id, rating: data.rating, emittedEvent: 'review.added' };
  }

  private async handleAppInstalled(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('🎉 Processing app.installed', { merchant: data.merchant });
    this.eventEmitter.emit('app.installed', { tenantId: context.tenantId, storeId: context.storeId, merchant: data.merchant, raw: data });
    return { handled: true, action: 'app_installed', merchant: data.merchant, emittedEvent: 'app.installed' };
  }

  private async handleAppUninstalled(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('⚠️ Processing app.uninstalled', { merchant: data.merchant });
    this.eventEmitter.emit('app.uninstalled', { tenantId: context.tenantId, storeId: context.storeId, merchant: data.merchant, raw: data });
    return { handled: true, action: 'app_uninstalled', merchant: data.merchant, emittedEvent: 'app.uninstalled' };
  }

  private async handleOrderRefunded(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.refunded', { orderId: data.id });
    await this.updateOrderStatusInDatabase(data, context, OrderStatus.REFUNDED);
    this.eventEmitter.emit('order.refunded', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, status: data.status, raw: data });
    return { handled: true, action: 'order_refunded', orderId: data.id, emittedEvent: 'order.refunded' };
  }

  private async handleProductCreated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.created', { productId: data.id });
    this.eventEmitter.emit('product.created', { tenantId: context.tenantId, storeId: context.storeId, productId: data.id, raw: data });
    return { handled: true, action: 'product_created', productId: data.id, emittedEvent: 'product.created' };
  }

  private async handleCustomerOtpRequest(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.otp.request', { customerId: data.id });
    this.eventEmitter.emit('customer.otp.request', { tenantId: context.tenantId, storeId: context.storeId, customerId: data.id, raw: data });
    return { handled: true, action: 'customer_otp_request', customerId: data.id, emittedEvent: 'customer.otp.request' };
  }

  private async handleInvoiceCreated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing invoice.created', { invoiceId: data.id });
    this.eventEmitter.emit('invoice.created', { tenantId: context.tenantId, storeId: context.storeId, invoiceId: data.id, raw: data });
    return { handled: true, action: 'invoice_created', invoiceId: data.id, emittedEvent: 'invoice.created' };
  }

  @OnWorkerEvent('completed') onCompleted(job: Job) { this.logger.debug(`Job completed: ${job.id}`); }
  @OnWorkerEvent('failed') onFailed(job: Job, error: Error) { this.logger.error(`Job failed: ${job.id}`, { error: error.message, attempts: job.attemptsMade }); }
  @OnWorkerEvent('stalled') onStalled(jobId: string) { this.logger.warn(`Job stalled: ${jobId}`); }
}
