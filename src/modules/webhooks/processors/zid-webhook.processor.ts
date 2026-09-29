/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Zid Webhook Processor                            ║
 * ║                                                                                ║
 * ║  ✅ v3: إعادة كتابة كاملة — يتعامل مع payload زد الخام                       ║
 * ║  زد يرسل order_status كنص عربي + بيانات الطلب مباشرة بدون event              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ZidWebhooksService } from '../zid-webhooks.service';
import { WebhookStatus } from '@database/entities/webhook-event.entity';
import { WebhookLogAction } from '../entities/webhook-log.entity';
import { Order, OrderStatus } from '@database/entities/order.entity';
import { Customer, CustomerStatus } from '@database/entities/customer.entity';
import { Store, StoreStatus } from '../../../modules/stores/entities/store.entity';
import { getErrorMessage } from '@common/utils/error.util';

interface ZidWebhookJobData {
  webhookEventId: string;
  eventType: string;
  storeId: string;
  data: Record<string, unknown>;
  tenantId?: string;
  internalStoreId?: string;
  isRetry?: boolean;
}

@Processor('zid-webhooks', {
  concurrency: 10,
  limiter: { max: 100, duration: 1000 },
})
export class ZidWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(ZidWebhookProcessor.name);

  constructor(
    private readonly zidWebhooksService: ZidWebhooksService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
  ) {
    super();
  }

  async process(job: Job<ZidWebhookJobData>): Promise<void> {
    const startTime = Date.now();
    const { webhookEventId, eventType, data, tenantId, internalStoreId } = job.data;

    this.logger.log(`🔄 Processing Zid webhook: ${eventType}`, {
      jobId: job.id,
      webhookEventId,
      attempt: job.attemptsMade + 1,
    });

    try {
      // تحديث حالة الحدث → PROCESSING
      await this.zidWebhooksService.updateStatus(webhookEventId, WebhookStatus.PROCESSING);
      const attempts = await this.zidWebhooksService.incrementAttempts(webhookEventId);

      await this.zidWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_STARTED,
        previousStatus: WebhookStatus.PENDING,
        newStatus: WebhookStatus.PROCESSING,
        message: `Processing attempt #${attempts}`,
        attemptNumber: attempts,
      });

      const context = { tenantId, storeId: internalStoreId, webhookEventId };

      // ══════════════════════════════════════════════════════════════════════
      // 📌 معالجة كل نوع حدث
      // ══════════════════════════════════════════════════════════════════════
      let result: Record<string, unknown>;

      switch (eventType) {
        // Orders - تدعم كل الصيغ الممكنة من Zid
        case 'new-order':
        case 'order.new':
        case 'order.create':      // ✅ v3: هذا الاسم الفعلي المسجّل في زد + المكتشف من Controller
          result = await this.handleNewOrder(data, context);
          break;
        case 'order-update':
        case 'order.update':
        case 'order-status-update':
        case 'order.status.update': // ✅ وثائق Zid الرسمية: order.status.update
          result = await this.handleOrderUpdate(data, context);
          break;

        // ✅ وثائق Zid الرسمية: order.payment_status.update
        // "Triggered when an order's payment status changes to paid or unpaid"
        // يُرسل حقل payment_status_change مع القيم القديمة والجديدة
        case 'order.payment_status.update':
          result = await this.handleOrderPaymentStatusUpdate(data, context);
          break;

        case 'order-cancelled':
        case 'order.cancel':
        case 'order.cancelled':
          result = await this.handleOrderCancelled(data, context);
          break;
        case 'order-refunded':
        case 'order.refund':
        case 'order.refunded':
          result = await this.handleOrderRefunded(data, context);
          break;

        // Customers — وثائق Zid: 4 أحداث رسمية
        case 'new-customer':
        case 'customer.new':
        case 'customer.create':
          result = await this.handleNewCustomer(data, context);
          break;
        case 'customer-update':
        case 'customer.update':
          result = await this.handleCustomerUpdate(data, context);
          break;
        // ✅ وثائق Zid الرسمية: customer.login
        // "Triggered when a customer logs into the store"
        case 'customer.login':
          result = await this.handleCustomerLogin(data, context);
          break;
        // ✅ وثائق Zid الرسمية: customer.merchant.update
        // "Triggered when a merchant updates their business information"
        case 'customer.merchant.update':
          result = await this.handleCustomerMerchantUpdate(data, context);
          break;

        // Products — وثائق Zid: 4 أحداث رسمية
        case 'product-create':
        case 'product.create':
        case 'product-update':
        case 'product.update':
        case 'product-delete':
        case 'product.delete':
          result = await this.handleProductEvent(eventType, data, context);
          break;
        // ✅ وثائق Zid الرسمية: product.publish
        // "Triggered when a product is published (moved from draft to active)"
        case 'product.publish':
          result = await this.handleProductEvent('product.publish', data, context);
          break;

        // Cart — وثائق Zid: 2 أحداث رسمية
        // ✅ abandoned_cart.created: بدأ التخلي عن السلة (phase != completed)
        case 'abandoned_cart.created':
        case 'abandoned-cart':
        case 'cart.abandoned':
          result = await this.handleAbandonedCart(data, context);
          break;
        // ✅ abandoned_cart.completed: أكمل العميل الشراء بعد التخلي
        case 'abandoned_cart.completed':
          result = await this.handleAbandonedCartCompleted(data, context);
          break;

        // Categories — وثائق Zid: 3 أحداث رسمية
        // ✅ category.create / category.update / category.delete
        case 'category.create':
        case 'category.update':
        case 'category.delete':
          result = await this.handleCategoryEvent(eventType, data, context);
          break;

        // Reviews
        case 'new-review':
        case 'review.new':
        case 'review.added':
          result = await this.handleNewReview(data, context);
          break;

        // Inventory
        case 'inventory-low':
        case 'inventory.low':
        case 'product.quantity.low':
          result = await this.handleInventoryLow(data, context);
          break;

        // App lifecycle - local events
        case 'app-installed':
        case 'app.installed':
          result = { handled: true, action: eventType };
          this.eventEmitter.emit(eventType, { tenantId, storeId: internalStoreId, raw: data });
          break;
        // ✅ FIX: App Market events from Partner Dashboard (event_name field)
        case 'app-uninstalled':
        case 'app.uninstalled':
        case 'app.market.application.uninstall':
          result = await this.handleAppUninstalled(data, context);
          break;

        // ✅ FIX: App Market install/subscription events
        case 'app.market.application.install':
        case 'app.market.application.authorized':
          result = await this.handleAppInstalled(data, context);
          break;

        case 'app.market.subscription.active':
        case 'app.market.subscription.renew':
        case 'app.market.subscription.upgrade':
          result = await this.handleSubscriptionActive(data, context);
          break;

        case 'app.market.subscription.suspended':
        case 'app.market.subscription.expired':
          result = await this.handleSubscriptionExpired(data, context);
          break;

        case 'app.market.subscription.refunded':
          result = { handled: true, action: eventType };
          this.eventEmitter.emit('store.subscription.refunded', { tenantId, storeId: internalStoreId, raw: data });
          break;

        case 'app.market.subscription.warning':
          result = { handled: true, action: eventType };
          this.eventEmitter.emit('store.subscription.warning', { tenantId, storeId: internalStoreId, raw: data });
          break;

        case 'app.market.application.rated':
        case 'app.market.private.plan.request':
          result = { handled: true, action: eventType };
          this.eventEmitter.emit(eventType, { tenantId, storeId: internalStoreId, raw: data });
          break;

        default:
          this.logger.warn(`⚠️ Unknown Zid event type: ${eventType} — emitting as-is`);
          this.eventEmitter.emit(eventType, { tenantId, storeId: internalStoreId, raw: data, source: 'zid' });
          result = { handled: true, action: 'unknown_event_forwarded', eventType };
          break;
      }

      // ✅ تحديث الحالة → PROCESSED
      const processingDurationMs = Date.now() - startTime;
      await this.zidWebhooksService.updateStatus(webhookEventId, WebhookStatus.PROCESSED, {
        processingResult: result,
        processingDurationMs,
      });

      await this.zidWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSED,
        previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.PROCESSED,
        message: `Processed successfully in ${processingDurationMs}ms`,
        durationMs: processingDurationMs,
        metadata: result,
      });


      // ✅ إطلاق حدث webhook.processed لنظام تنبيهات الموظفين
      // ✅ normalize Zid event names → NotificationTriggerEvent values
      const normalizedEventType = (
        eventType === 'order.create'            ? 'order.created' :
        eventType === 'order.new'               ? 'order.created' :
        eventType === 'order.update'            ? 'order.updated' :
        eventType === 'order.status.update'     ? 'order.status.updated' :
        eventType === 'order.payment_status.update' ? 'order.payment.updated' :
        eventType === 'order.cancel'            ? 'order.cancelled' :
        eventType === 'order.refund'            ? 'order.refunded' :
        eventType === 'customer.create'         ? 'customer.created' :
        eventType === 'customer.new'            ? 'customer.created' :
        eventType === 'customer.update'         ? 'customer.updated' :
        eventType === 'product.update'          ? 'product.updated' :
        eventType === 'product.quantity.low'    ? 'product.low_stock' :
        eventType === 'abandoned_cart.created'  ? 'abandoned.cart' :
        eventType
      );
      this.eventEmitter.emit('webhook.processed', {
        webhookEventId,
        eventType: normalizedEventType,
        tenantId,
        storeId: internalStoreId,
        data: job.data.data,
      });

      this.logger.log(`✅ Zid webhook processed: ${eventType} in ${processingDurationMs}ms`);

    } catch (error) {
      const processingDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`❌ Zid webhook processing failed: ${eventType}`, {
        error: errorMessage,
        webhookEventId,
        attempt: job.attemptsMade + 1,
      });

      await this.zidWebhooksService.updateStatus(webhookEventId, WebhookStatus.FAILED, {
        errorMessage,
        processingDurationMs,
      });

      await this.zidWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_FAILED,
        previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.FAILED,
        message: `Failed: ${errorMessage}`,
        errorDetails: { error: errorMessage, stack: error instanceof Error ? error.stack : undefined },
        durationMs: processingDurationMs,
      });

      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Order Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleNewOrder(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid new-order', { orderId: data.id, code: data.code });

    // ✅ v3: العميل موجود في data.customer مباشرة (payload زد الخام)
    const customer = data.customer as Record<string, unknown> | undefined;
    let savedCustomer: Customer | null = null;
    if (customer?.id) {
      savedCustomer = await this.syncCustomerToDatabase(customer, context);
    }

    // حفظ الطلب في قاعدة البيانات
    if (context.storeId && data.id) {
      await this.syncOrderToDatabase(data, context, savedCustomer?.id);
    }

    this.eventEmitter.emit('order.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      orderNumber: data.code || data.invoice_number || data.order_number,
      total: data.order_total,
      customerName: customer?.name,
      customerPhone: customer?.mobile || customer?.phone,
      raw: data,  // ✅ كامل بيانات الطلب
      source: 'zid',
    });

    return { handled: true, action: 'new_order', orderId: data.id, emittedEvent: 'order.created' };
  }

  private async handleOrderUpdate(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid order-update', {
      orderId: data.id,
      orderStatus: data.order_status,
      displayStatus: JSON.stringify(data.display_status),
    });

    if (context.tenantId && data.id) {
      await this.updateOrderStatusInDatabase(data, context);
    }

    // ✅ v3: استخراج الحالة من بيانات زد الحقيقية
    // زد يرسل: order_status = "جاهز" (نص عربي) أو display_status = { slug, name, code }
    const statusSlug = this.extractZidStatusSlug(data.order_status || data.display_status || data.status);
    const specificEvent = this.mapZidStatusToEvent(statusSlug);

    this.logger.log('🔄 Zid status mapping:', {
      rawOrderStatus: data.order_status,
      rawDisplayStatus: JSON.stringify(data.display_status),
      extractedSlug: statusSlug,
      specificEvent: specificEvent || 'NONE → will use fallback',
    });

    // ✅ v3: استخراج بيانات العميل من الـ payload الخام
    const customer = data.customer as Record<string, unknown> | undefined;

    const eventPayload = {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      orderNumber: data.code || data.invoice_number || data.order_number,
      status: data.order_status,
      newStatus: data.order_status,
      previousStatus: data.previous_status,
      customerName: customer?.name,
      customerPhone: customer?.mobile || customer?.phone,
      raw: data,  // ✅ كامل بيانات الطلب — template-dispatcher يستخرج الهاتف من raw.customer
      source: 'zid',
    };

    if (specificEvent) {
      this.logger.log(`📌 Emitting: ${specificEvent}`);
      this.eventEmitter.emit(specificEvent, eventPayload);
    } else {
      // ✅ v3: Fallback — حالة غير معروفة → نرسل event بناءً على الـ slug
      const fallbackEvent = statusSlug ? `order.status.${statusSlug}` : 'order.status.updated';
      this.logger.warn(`⚠️ No mapping for Zid status "${statusSlug}" → emitting fallback: ${fallbackEvent}`);
      this.eventEmitter.emit(fallbackEvent, eventPayload);
    }

    return {
      handled: true,
      action: 'order_update',
      orderId: data.id,
      statusSlug,
      specificEvent: specificEvent || `fallback:order.status.${statusSlug || 'updated'}`,
    };
  }

  private async handleOrderCancelled(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid order-cancelled', { orderId: data.id });

    if (context.tenantId && data.id) {
      try {
        const order = await this.findZidOrder(String(data.id), context);
        if (order) {
          order.zidOrderId = String(data.id);
          order.status = OrderStatus.CANCELLED;
          order.cancelledAt = new Date();
          await this.orderRepository.save(order);
        }
      } catch (error: unknown) {
        this.logger.warn(`Could not mark Zid order ${String(data.id)} cancelled: ${getErrorMessage(error)}`);
      }
    }

    this.eventEmitter.emit('order.cancelled', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'order_cancelled', orderId: data.id };
  }

  private async handleOrderRefunded(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid order-refunded', { orderId: data.id });

    if (context.tenantId && data.id) {
      try {
        const order = await this.findZidOrder(String(data.id), context);
        if (order) {
          order.zidOrderId = String(data.id);
          order.status = OrderStatus.REFUNDED;
          await this.orderRepository.save(order);
        }
      } catch (error: unknown) {
        this.logger.warn(`Could not mark Zid order ${String(data.id)} refunded: ${getErrorMessage(error)}`);
      }
    }

    this.eventEmitter.emit('order.refunded', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'order_refunded', orderId: data.id };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customer Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleNewCustomer(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid new-customer', { customerId: data.id });

    const saved = await this.syncCustomerToDatabase(data, context);

    this.eventEmitter.emit('customer.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'new_customer', customerId: data.id, dbCustomerId: saved?.id };
  }

  private async handleCustomerUpdate(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid customer-update', { customerId: data.id });

    await this.syncCustomerToDatabase(data, context);

    this.eventEmitter.emit('customer.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'customer_update', customerId: data.id };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚫 App Lifecycle Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 App Lifecycle Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ معالجة app.market.application.install / authorized
   * عندما يقوم التاجر بتثبيت التطبيق من متجره
   */
  private async handleAppInstalled(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    const zidStoreId = data.store_id ? String(data.store_id) : undefined;
    const storeUuid = data.store_uuid ? String(data.store_uuid) : undefined;
    const merchantEmail = data.merchant_email as string | undefined;

    this.logger.log('🎉 Processing app.market.application.install', {
      zidStoreId,
      storeUuid,
      merchantEmail,
      planName: data.plan_name,
    });

    // إطلاق حدث للإشعار بالتثبيت
    // ✅ وثائق Zid: كل حقول payload الرسمية
    this.eventEmitter.emit('store.installed', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      zidStoreId,
      storeUuid,
      storeUrl: data.store_url,
      merchantEmail,
      merchantPhone: data.merchant_phone_no,   // ✅ من الوثائق
      planName: data.plan_name,
      planType: data.plan_type,                 // ✅ من الوثائق: Paid / Free
      planId: data.plan_id,                     // ✅ من الوثائق
      oldPlanName: data.old_plan_name,          // ✅ من الوثائق
      status: data.status,
      startDate: data.start_date,
      endDate: data.end_date,
      amountPaid: data.amount_paid,
      paymentDate: data.payment_date,           // ✅ من الوثائق
      installedAt: new Date().toISOString(),
      raw: data,
    });

    return {
      handled: true,
      action: 'app_installed',
      zidStoreId,
      emittedEvent: 'store.installed',
    };
  }

  /**
   * ✅ معالجة app.market.subscription.active / renew / upgrade
   */
  private async handleSubscriptionActive(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    const zidStoreId = data.store_id ? String(data.store_id) : undefined;

    this.logger.log('💳 Processing subscription active/renew/upgrade', {
      zidStoreId,
      planName: data.plan_name,
      status: data.status,
      endDate: data.end_date,
    });

    // تفعيل المتجر إذا كان معلّقاً
    if (zidStoreId) {
      try {
        const store = await this.storeRepository.findOne({ where: { zidStoreId } });
        if (store && store.status !== StoreStatus.ACTIVE) {
          await this.storeRepository.update({ id: store.id }, { status: StoreStatus.ACTIVE });
          this.logger.log(`✅ Store reactivated: ${store.id}`);
        }
      } catch (error: unknown) {
        this.logger.warn(`Could not reactivate Zid store ${zidStoreId}: ${getErrorMessage(error)}`);
      }
    }

    this.eventEmitter.emit('store.subscription.active', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      zidStoreId,
      storeUrl: data.store_url,
      merchantEmail: data.merchant_email,
      merchantPhone: data.merchant_phone_no,   // ✅ من الوثائق
      planName: data.plan_name,
      planType: data.plan_type,                 // ✅ من الوثائق
      planId: data.plan_id,                     // ✅ من الوثائق
      oldPlanName: data.old_plan_name,          // ✅ من الوثائق
      status: data.status,
      startDate: data.start_date,
      endDate: data.end_date,
      amountPaid: data.amount_paid,
      paymentDate: data.payment_date,           // ✅ من الوثائق
      raw: data,
    });

    return { handled: true, action: 'subscription_active', zidStoreId };
  }

  /**
   * ✅ معالجة app.market.subscription.suspended / expired
   * تعليق خدمة المتجر عند انتهاء الاشتراك
   */
  private async handleSubscriptionExpired(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    const zidStoreId = data.store_id ? String(data.store_id) : undefined;
    const merchantEmail = data.merchant_email as string | undefined;

    this.logger.log('⏰ Processing subscription expired/suspended', {
      zidStoreId,
      planName: data.plan_name,
      status: data.status,
      endDate: data.end_date,
      eventName: data.event_name,
    });

    // تعليق المتجر في قاعدة البيانات
    if (zidStoreId) {
      try {
        const store = await this.storeRepository.findOne({ where: { zidStoreId } });
        if (store) {
          await this.storeRepository.update({ id: store.id }, { status: StoreStatus.SUSPENDED });
          this.logger.log(`⚠️ Store suspended due to subscription expiry: ${store.id}`);
        }
      } catch (error: unknown) {
        this.logger.warn(`Could not suspend Zid store ${zidStoreId}: ${getErrorMessage(error)}`);
      }
    }

    this.eventEmitter.emit('store.subscription.expired', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      zidStoreId,
      storeUrl: data.store_url,
      merchantEmail,
      merchantPhone: data.merchant_phone_no,   // ✅ من الوثائق
      planName: data.plan_name,
      planType: data.plan_type,                 // ✅ من الوثائق
      planId: data.plan_id,                     // ✅ من الوثائق
      status: data.status,
      startDate: data.start_date,
      expiredAt: data.end_date,
      eventName: data.event_name,               // ✅ suspended vs expired
      raw: data,
    });

    return {
      handled: true,
      action: 'subscription_expired',
      zidStoreId,
      emittedEvent: 'store.subscription.expired',
    };
  }

  /**
   * ✅ معالجة app.uninstalled / app.market.application.uninstall
   * عندما يقوم التاجر بإلغاء تثبيت التطبيق من متجره
   */
  private async handleAppUninstalled(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('🗑️ Processing app.uninstalled', { 
      storeId: data.store_id || context.storeId,
      zidStoreId: data.store_id,
    });

    const zidStoreId = data.store_id ? String(data.store_id) : undefined;
    
    if (!zidStoreId) {
      this.logger.warn('⚠️ No store_id in app.uninstalled payload');
      return { handled: false, error: 'Missing store_id' };
    }

    // تحديث حالة المتجر في قاعدة البيانات
    try {
      // البحث عن المتجر بـ zidStoreId using Store repository
      const store = await this.storeRepository.findOne({
        where: { zidStoreId },
      });

      if (store) {
        // تحديث الحالة إلى UNINSTALLED using Store repository with raw query for nullable fields
        await this.storeRepository
          .createQueryBuilder()
          .update(Store)
          .set({
            status: StoreStatus.UNINSTALLED,
            accessToken: () => 'NULL',
            refreshToken: () => 'NULL',
            tokenExpiresAt: () => 'NULL',
          })
          .where('id = :id', { id: store.id })
          .execute();

        this.logger.log(`✅ Store marked as uninstalled: ${store.id}`);

        // إطلاق حدث للإشعار
        this.eventEmitter.emit('store.uninstalled', {
          tenantId: store.tenantId,
          storeId: store.id,
          zidStoreId,
          uninstalledAt: new Date().toISOString(),
        });

        return { 
          handled: true, 
          action: 'app_uninstalled', 
          storeId: store.id,
          emittedEvent: 'store.uninstalled',
        };
      } else {
        this.logger.warn(`⚠️ Store not found for Zid store ${zidStoreId}`);
        return { handled: false, error: 'Store not found' };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Failed to handle app.uninstalled: ${msg}`);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Product / Cart / Review / Inventory Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleProductEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log(`Processing Zid ${eventType}`, { productId: data.id });

    // ✅ وثائق Zid: 4 أحداث رسمية للمنتجات
    const emitEvent =
      (eventType === 'product-create' || eventType === 'product.create')  ? 'product.created'  :
      (eventType === 'product-delete' || eventType === 'product.delete')  ? 'product.deleted'  :
      (eventType === 'product.publish')                                   ? 'product.published' :
      'product.updated';

    // ✅ وثائق Zid: product.name هو object { ar, en } أو string
    const rawName = data.name;
    const productName = typeof rawName === 'object' && rawName !== null
      ? ((rawName as Record<string, string>).ar || (rawName as Record<string, string>).en || '')
      : (rawName as string | undefined);

    this.eventEmitter.emit(emitEvent, {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName,
      productNameAr: typeof rawName === 'object' ? (rawName as Record<string, string>).ar : rawName,
      productNameEn: typeof rawName === 'object' ? (rawName as Record<string, string>).en : rawName,
      sku: data.sku,
      isPublished: data.is_published,
      isDraft: data.is_draft,
      price: data.price,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: eventType, productId: data.id, emittedEvent: emitEvent };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💳 Order Payment Status Handler — وثائق Zid: order.payment_status.update
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ وثائق Zid الرسمية: order.payment_status.update
   * "Triggered when an order's payment status changes to paid or unpaid"
   * Payload: { payment_status_change: { old, new }, id, store_id, ... }
   */
  private async handleOrderPaymentStatusUpdate(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    const paymentChange = data.payment_status_change as Record<string, unknown> | undefined;
    const newStatus = paymentChange?.new ?? data.payment_status;
    const oldStatus = paymentChange?.old;

    this.logger.log('💳 Processing Zid order.payment_status.update', {
      orderId: data.id,
      oldStatus,
      newStatus,
    });

    // تحديث حالة الطلب في DB إذا أصبح مدفوعاً
    if (context.tenantId && data.id && newStatus === 'paid') {
      try {
        const order = await this.findZidOrder(String(data.id), context);
        if (order) {
          order.zidOrderId = String(data.id);
          order.status = OrderStatus.PAID;
          await this.orderRepository.save(order);
        }
      } catch (error: unknown) {
        this.logger.warn(`Could not mark Zid order ${String(data.id)} paid: ${getErrorMessage(error)}`);
      }
    }

    this.eventEmitter.emit('order.payment_status.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      oldPaymentStatus: oldStatus,
      newPaymentStatus: newStatus,
      isPaid: newStatus === 'paid',
      raw: data,
      source: 'zid',
    });

    return {
      handled: true,
      action: 'order_payment_status_update',
      orderId: data.id,
      oldStatus,
      newStatus,
    };
  }

  /**
   * ✅ وثائق Zid الرسمية: abandoned_cart.created
   * AbandonedCart schema: cart_total, cart_total_string, phase, url,
   *   reminders_count, customer_id, customer_name, customer_email, customer_mobile
   */
  private async handleAbandonedCart(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('🛒 Processing Zid abandoned_cart.created', {
      cartId: data.id,
      phase: data.phase,
      customerId: data.customer_id,
    });

    // زد يُرسل بيانات العميل مدمجة في نفس الـ payload (customer_name, customer_mobile...)
    // وليس nested object — نتحقق من كلا الطريقتين
    const nestedCustomer = data.customer as Record<string, unknown> | undefined;
    if (nestedCustomer?.id) await this.syncCustomerToDatabase(nestedCustomer, context);

    this.eventEmitter.emit('cart.abandoned', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      cartId: data.id,
      // ✅ وثائق Zid: flat fields في abandoned_cart payload
      customerId: data.customer_id ?? nestedCustomer?.id,
      customerName: data.customer_name ?? nestedCustomer?.name,
      customerPhone: data.customer_mobile ?? nestedCustomer?.mobile,
      customerEmail: data.customer_email ?? nestedCustomer?.email,
      cartTotal: data.cart_total ?? data.total,
      cartTotalString: data.cart_total_string,
      phase: data.phase,
      cartUrl: data.url,
      remindersCount: data.reminders_count,
      items: data.items,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'abandoned_cart_created', cartId: data.id };
  }

  /**
   * ✅ وثائق Zid الرسمية: abandoned_cart.completed
   * "Triggered when a customer completes a purchase after abandoning a cart"
   * Payload: نفس AbandonedCart schema لكن phase === 'completed'
   * الفرق التجاري: هذا يعني نجاح حملة استرداد السلة
   */
  private async handleAbandonedCartCompleted(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('✅ Processing Zid abandoned_cart.completed', {
      cartId: data.id,
      customerId: data.customer_id,
      cartTotal: data.cart_total,
    });

    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer?.id) await this.syncCustomerToDatabase(customer, context);

    // استرداد السلة = نجاح → emit event يختلف عن التخلي
    this.eventEmitter.emit('cart.recovered', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      cartId: data.id,
      customerId: data.customer_id,
      customerName: customer?.name ?? data.customer_name,
      customerPhone: customer?.mobile ?? data.customer_mobile,
      customerEmail: customer?.email ?? data.customer_email,
      cartTotal: data.cart_total,
      remindersCount: data.reminders_count,
      phase: data.phase,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'abandoned_cart_completed', cartId: data.id };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customer Extra Handlers — وثائق Zid: customer.login + customer.merchant.update
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ وثائق Zid الرسمية: customer.login
   * "Triggered when a customer logs into the store"
   * Payload: Customer schema (نفس customer.create لكن يُرسل عند كل دخول)
   */
  private async handleCustomerLogin(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('🔐 Processing Zid customer.login', {
      customerId: data.id,
      email: data.email,
    });

    this.eventEmitter.emit('customer.login', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      name: data.name,
      email: data.email,
      mobile: data.mobile ?? data.telephone,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'customer_login', customerId: data.id };
  }

  /**
   * ✅ وثائق Zid الرسمية: customer.merchant.update
   * "Triggered when a merchant updates their business/commercial information"
   * Payload: يحتوي على بيانات تجارية مثل business_name, tax_number, commercial_registration
   */
  private async handleCustomerMerchantUpdate(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('🏪 Processing Zid customer.merchant.update', {
      customerId: data.id,
      businessName: data.business_name,
    });

    // sync عام للعميل
    await this.syncCustomerToDatabase(data, context);

    this.eventEmitter.emit('customer.merchant.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      businessName: data.business_name,
      taxNumber: data.tax_number,
      commercialRegistration: data.commercial_registration,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'customer_merchant_update', customerId: data.id };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📂 Category Handlers — وثائق Zid: category.create / update / delete
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ وثائق Zid الرسمية: category.create / category.update / category.delete
   * Payload: ProductCategory schema
   *   { id, name, slug, flat_name, is_published, sub_categories, products_count, ... }
   */
  private async handleCategoryEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log(`📂 Processing Zid ${eventType}`, {
      categoryId: data.id,
      categoryName: data.name,
    });

    // تحديد الـ event المُصدَر بناءً على نوع الحدث
    const emitEvent =
      eventType === 'category.create' ? 'category.created'  :
      eventType === 'category.delete' ? 'category.deleted'  :
      'category.updated';

    // ✅ وثائق Zid: category.names هو object { ar, en } — نستخرج الاثنين
    const rawNames = data.names as Record<string, string> | undefined;
    const categoryNameAr = rawNames?.ar || (typeof data.name === 'string' ? data.name : '');
    const categoryNameEn = rawNames?.en || '';

    this.eventEmitter.emit(emitEvent, {
      tenantId: context.tenantId,
      storeId: context.storeId,
      categoryId: data.id,
      categoryName: categoryNameAr || categoryNameEn,
      categoryNameAr,
      categoryNameEn,
      categorySlug: data.slug,
      flatName: data.flat_name,
      isPublished: data.is_published,
      parentId: data.parent_id ?? null,
      subCategories: data.sub_categories,
      productsCount: data.products_count,
      url: data.url,
      raw: data,
      source: 'zid',
    });

    return {
      handled: true,
      action: eventType.replace('.', '_'),
      categoryId: data.id,
      emittedEvent: emitEvent,
    };
  }

  private async handleNewReview(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid new-review', { reviewId: data.id });

    this.eventEmitter.emit('review.added', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      reviewId: data.id,
      productId: data.product_id,
      rating: data.rating,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'new_review', reviewId: data.id };
  }

  private async handleInventoryLow(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('⚠️ Zid inventory-low', { productId: data.id, quantity: data.quantity });

    this.eventEmitter.emit('product.quantity.low', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName: data.name,
      currentQuantity: data.quantity,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'inventory_low', productId: data.id, quantity: data.quantity };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💾 Database Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async syncOrderToDatabase(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
    customerId?: string,
  ): Promise<Order | null> {
    if (!context.storeId || !data.id) return null;

    try {
      const zidOrderId = String(data.id);
      let order = await this.orderRepository.findOne({
        where: [
          { zidOrderId, storeId: context.storeId },
          { sallaOrderId: zidOrderId, storeId: context.storeId },
        ],
      });

      const rawItems = (data.products as Record<string, unknown>[] | undefined) 
                     || (data.items as Record<string, unknown>[] | undefined) 
                     || [];
      const items = rawItems.map(item => ({
        productId: String(item.product_id || item.id || ''),
        name: String(item.name || ''),
        sku: (item.sku as string) || undefined,
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.price || item.unit_price || 0),
        totalPrice: Number(item.total || 0),
      }));

      // ✅ v3: استخراج المبلغ — زد يرسل order_total كـ object أو رقم
      const orderTotal = data.order_total;
      const totalAmount = typeof orderTotal === 'object' && orderTotal !== null
        ? Number((orderTotal as Record<string, unknown>).amount || (orderTotal as Record<string, unknown>).total || 0)
        : Number(orderTotal || data.total || 0);

      if (!order) {
        order = this.orderRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          customerId: customerId || undefined,
          zidOrderId,
          referenceId: (data.code as string) || (data.invoice_number as string) || (data.order_number as string) || undefined,
          status: this.mapZidOrderStatus(data.order_status || data.status),
          totalAmount,
          subtotal: Number(data.sub_total || totalAmount) || 0,
          currency: String(data.currency_code || data.currency || 'SAR'),
          items,
          metadata: { source: 'zid', zidData: data },
        });
      } else {
        order.status = this.mapZidOrderStatus(data.order_status || data.status);
        order.totalAmount = totalAmount || order.totalAmount;
        if (customerId) order.customerId = customerId;
        if (items.length > 0) order.items = items;
        order.zidOrderId = zidOrderId;
        order.metadata = { ...(order.metadata || {}), source: 'zid', zidData: data };
      }

      return await this.orderRepository.save(order);
    } catch (error) {
      this.logger.error(`Failed to sync Zid order ${data.id}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  private findZidOrder(
    zidOrderId: string,
    context: { tenantId?: string; storeId?: string },
  ): Promise<Order | null> {
    const scope = context.storeId ? { storeId: context.storeId } : { tenantId: context.tenantId };
    return this.orderRepository.findOne({
      where: [
        { ...scope, zidOrderId },
        // Legacy compatibility: earlier Zid webhooks incorrectly stored the external ID here.
        { ...scope, sallaOrderId: zidOrderId },
      ],
    });
  }

  private async updateOrderStatusInDatabase(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
  ): Promise<void> {
    if (!context.storeId || !data.id) return;

    try {
      const zidOrderId = String(data.id);
      const order = await this.orderRepository.findOne({
        where: [
          { zidOrderId, storeId: context.storeId },
          { sallaOrderId: zidOrderId, storeId: context.storeId },
        ],
      });

      if (!order) {
        this.logger.warn(`⚠️ Zid order ${zidOrderId} not in DB - creating`);
        await this.syncOrderToDatabase(data, context);
        return;
      }

      order.status = this.mapZidOrderStatus(data.order_status || data.status);
      order.zidOrderId = zidOrderId;
      order.metadata = {
        ...(order.metadata || {}),
        source: 'zid',
        zidData: { ...(order.metadata?.zidData || {}), lastWebhookData: data },
      };
      await this.orderRepository.save(order);
    } catch (error) {
      this.logger.error(`Failed to update Zid order status ${data.id}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  private async syncCustomerToDatabase(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
  ): Promise<Customer | null> {
    if (!context.storeId || !data.id) return null;

    try {
      const zidCustomerId = String(data.id);
      let customer = await this.customerRepository.findOne({
        where: [
          { zidCustomerId, storeId: context.storeId },
          { sallaCustomerId: zidCustomerId, storeId: context.storeId },
        ],
      });

      // Zid sends name as single field, not first_name/last_name
      const fullName = String(data.name || '');
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || String(data.first_name || '');
      const lastName = nameParts.slice(1).join(' ') || String(data.last_name || '');
      // ✅ وثائق Zid: Customer schema يستخدم telephone (ليس mobile)
      // لكن order.customer يستخدم mobile — نتحقق من كلاهما
      const phone = (data.telephone as string)
                 || (data.mobile as string)
                 || (data.phone as string)
                 || undefined;
      const email = (data.email as string) || undefined;

      if (!customer) {
        customer = this.customerRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          zidCustomerId,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          fullName: fullName || (firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined),
          email,
          phone,
          status: CustomerStatus.ACTIVE,
          metadata: { source: 'zid', zidData: data },
          address: data.city || data.country ? {
            city: data.city ? String(data.city) : undefined,
            country: data.country ? String(data.country) : undefined,
          } : undefined,
        });
      } else {
        if (firstName) customer.firstName = firstName;
        if (lastName) customer.lastName = lastName;
        if (fullName) customer.fullName = fullName;
        if (email) customer.email = email;
        if (phone) customer.phone = phone;
        customer.zidCustomerId = zidCustomerId;
        customer.metadata = { ...(customer.metadata || {}), source: 'zid', zidData: data };
      }

      return await this.customerRepository.save(customer);
    } catch (error) {
      this.logger.error(`Failed to sync Zid customer ${data.id}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  /**
   * ✅ v3: استخراج slug الحالة من بيانات زد
   *
   * زد يرسل الحالة بعدة أشكال:
   * 1. order_status = "جاهز" (نص عربي مباشر)
   * 2. display_status = { slug: "ready", name: "جاهز", code: "ready" }
   * 3. status = "ready" (نص إنجليزي)
   *
   * نحاول استخراج slug إنجليزي أولاً، ثم نقبل العربي
   */
  private extractZidStatusSlug(status: unknown): string {
    if (typeof status === 'string') {
      return status.toLowerCase().trim();
    }
    if (typeof status === 'object' && status !== null) {
      const obj = status as Record<string, unknown>;
      // الأولوية: slug > code > name > status
      const slug = obj.slug || obj.code || obj.status;
      if (slug && typeof slug === 'string') {
        return slug.toLowerCase().trim();
      }
      // fallback: name (قد يكون عربي)
      if (obj.name && typeof obj.name === 'string') {
        return obj.name.toLowerCase().trim();
      }
    }
    return '';
  }

  /**
   * ✅ v3: تحويل حالة زد → event محدد يسمعه template-dispatcher
   *
   * ⚠️ زد يرسل order_status كنص عربي: "جاهز", "مكتمل", "جديد"
   * أو display_status.slug كنص إنجليزي: "ready", "completed"
   * نغطي الاثنين
   */
  /**
   * ✅ v4 — محدّث ليشمل كل حالات وثائق Zid الرسمية
   *
   * حالات Zid الرسمية (من Order schema):
   *   new, failed, refunded, reversed, chargeback, expired, processed, voided,
   *   ready, processingReverse, preparing, inDelivery, delivered, cancelled,
   *   denied, canceledReversal
   *
   * ⚠️ زد يرسل order_status كنص عربي أو display_status.code كإنجليزي
   */
  private mapZidStatusToEvent(statusSlug: string): string | null {
    const map: Record<string, string> = {
      // ═══ حالات Zid الرسمية (إنجليزي) ═══

      // جديد
      'new':                  'order.created',
      'pending':              'order.created',
      'created':              'order.created',

      // قيد التحضير
      'preparing':            'order.status.processing',
      'processing':           'order.status.processing',
      'confirmed':            'order.status.processing',
      'processed':            'order.status.processing',
      'in_progress':          'order.status.processing',
      'accepted':             'order.status.processing',
      'preparation':          'order.status.processing',

      // جاهز للشحن
      'ready':                'order.status.ready_to_ship',
      'ready_to_ship':        'order.status.ready_to_ship',
      'ready_for_pickup':     'order.status.ready_to_ship',

      // تم الشحن
      'shipped':              'order.shipped',
      'shipping':             'order.shipped',

      // جاري التوصيل — ✅ Zid يُرسل inDelivery (camelCase)
      'indelivery':           'order.status.in_transit',
      'inDelivery':           'order.status.in_transit',
      'in_delivery':          'order.status.in_transit',
      'in_transit':           'order.status.in_transit',
      'out_for_delivery':     'order.status.in_transit',
      'delivering':           'order.status.in_transit',
      'on_the_way':           'order.status.in_transit',

      // تم التوصيل
      'delivered':            'order.delivered',

      // مكتمل
      'completed':            'order.status.completed',
      'complete':             'order.status.completed',
      'done':                 'order.status.completed',

      // ملغي
      'cancelled':            'order.cancelled',
      'canceled':             'order.cancelled',
      'denied':               'order.cancelled',

      // مسترجع / مُعاد
      'refunded':             'order.refunded',
      'refund':               'order.refunded',
      'reversed':             'order.refunded',
      'canceledReversal':     'order.refunded',
      'cancelledreversal':    'order.refunded',

      // قيد الاسترداد — ✅ Zid: processingReverse
      'restoring':            'order.status.restoring',
      'restored':             'order.status.restoring',
      'processingReverse':    'order.status.restoring',
      'processingreverse':    'order.status.restoring',
      'reverse_in_progress':  'order.status.restoring',

      // معلق
      'on_hold':              'order.status.on_hold',
      'hold':                 'order.status.on_hold',
      'holded':               'order.status.on_hold',

      // مدفوع
      'paid':                 'order.status.paid',
      'payment_received':     'order.status.paid',

      // بانتظار الدفع
      'pending_payment':      'order.status.pending_payment',
      'awaiting_payment':     'order.status.pending_payment',
      'unpaid':               'order.status.pending_payment',

      // بانتظار المراجعة
      'under_review':         'order.status.under_review',
      'awaiting_review':      'order.status.under_review',
      'review':               'order.status.under_review',

      // احتيال / تحديات — Zid: chargeback, expired, voided, failed
      'chargeback':           'order.cancelled',
      'expired':              'order.cancelled',
      'voided':               'order.cancelled',
      'failed':               'order.cancelled',

      // ═══ حالات بالعربي (Zid يرسل order_status كنص عربي) ═══
      'جديد':                 'order.created',
      'قيد التنفيذ':          'order.status.processing',
      'قيد التحضير':          'order.status.processing',
      'جاهز':                 'order.status.ready_to_ship',
      'تم الشحن':             'order.shipped',
      'جاري التوصيل':         'order.status.in_transit',
      'تم التوصيل':           'order.delivered',
      'مكتمل':                'order.status.completed',
      'تم التنفيذ':           'order.status.completed',
      'ملغي':                 'order.cancelled',
      'مرفوض':                'order.cancelled',
      'مسترجع':               'order.refunded',
      'قيد الاسترجاع':        'order.status.restoring',
      'معلق':                 'order.status.on_hold',
      'مدفوع':                'order.status.paid',
      'بانتظار الدفع':        'order.status.pending_payment',
      'بانتظار المراجعة':     'order.status.under_review',
      'منتهي':                'order.cancelled',
      'مُلغى':                'order.cancelled',
    };

    return map[statusSlug] || null;
  }

  private mapZidOrderStatus(status: unknown): OrderStatus {
    const statusStr = this.extractZidStatusSlug(status);

    const statusMap: Record<string, OrderStatus> = {
      // ✅ حالات Zid الرسمية (إنجليزي)
      'new':                  OrderStatus.CREATED,
      'pending':              OrderStatus.CREATED,
      'confirmed':            OrderStatus.PROCESSING,
      'processing':           OrderStatus.PROCESSING,
      'processed':            OrderStatus.PROCESSING,
      'preparing':            OrderStatus.PROCESSING,
      'ready':                OrderStatus.READY_TO_SHIP,
      'ready_to_ship':        OrderStatus.READY_TO_SHIP,
      'shipped':              OrderStatus.SHIPPED,
      'in_transit':           OrderStatus.SHIPPED,
      'in_delivery':          OrderStatus.SHIPPED,
      'indelivery':           OrderStatus.SHIPPED,
      'inDelivery':           OrderStatus.SHIPPED,        // ✅ Zid camelCase
      'delivered':            OrderStatus.DELIVERED,
      'completed':            OrderStatus.COMPLETED,
      'complete':             OrderStatus.COMPLETED,
      'cancelled':            OrderStatus.CANCELLED,
      'canceled':             OrderStatus.CANCELLED,
      'denied':               OrderStatus.CANCELLED,      // ✅ Zid: denied
      'chargeback':           OrderStatus.CANCELLED,      // ✅ Zid: chargeback
      'expired':              OrderStatus.CANCELLED,      // ✅ Zid: expired
      'voided':               OrderStatus.CANCELLED,      // ✅ Zid: voided
      'refunded':             OrderStatus.REFUNDED,
      'reversed':             OrderStatus.REFUNDED,       // ✅ Zid: reversed
      'canceledReversal':     OrderStatus.REFUNDED,       // ✅ Zid: canceledReversal
      'cancelledreversal':    OrderStatus.REFUNDED,
      'on_hold':              OrderStatus.ON_HOLD,
      'hold':                 OrderStatus.ON_HOLD,
      'paid':                 OrderStatus.PAID,
      'failed':               OrderStatus.FAILED,
      'restoring':            OrderStatus.PROCESSING,     // قيد الاسترجاع
      'processingReverse':    OrderStatus.PROCESSING,     // ✅ Zid: processingReverse
      'processingreverse':    OrderStatus.PROCESSING,

      // ✅ حالات بالعربي
      'جديد':                 OrderStatus.CREATED,
      'قيد التنفيذ':          OrderStatus.PROCESSING,
      'قيد التحضير':          OrderStatus.PROCESSING,
      'جاهز':                 OrderStatus.READY_TO_SHIP,
      'تم الشحن':             OrderStatus.SHIPPED,
      'جاري التوصيل':         OrderStatus.SHIPPED,
      'تم التوصيل':           OrderStatus.DELIVERED,
      'مكتمل':                OrderStatus.COMPLETED,
      'تم التنفيذ':           OrderStatus.COMPLETED,
      'ملغي':                 OrderStatus.CANCELLED,
      'مرفوض':                OrderStatus.CANCELLED,
      'مسترجع':               OrderStatus.REFUNDED,
      'قيد الاسترجاع':        OrderStatus.PROCESSING,
      'معلق':                 OrderStatus.ON_HOLD,
      'مدفوع':                OrderStatus.PAID,
    };

    return statusMap[statusStr] || OrderStatus.CREATED;
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Zid job completed: ${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Zid job failed: ${job.id}`, { error: error.message, attempts: job.attemptsMade });
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Zid job stalled: ${jobId}`);
  }
}
