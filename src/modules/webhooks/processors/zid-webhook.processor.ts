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
        case 'order.status.update': // ✅ v3: هذا الاسم الفعلي المسجّل في زد + المكتشف من Controller
          result = await this.handleOrderUpdate(data, context);
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

        // Customers
        case 'new-customer':
        case 'customer.new':
        case 'customer.create':
          result = await this.handleNewCustomer(data, context);
          break;
        case 'customer-update':
        case 'customer.update':
          result = await this.handleCustomerUpdate(data, context);
          break;

        // Products
        case 'product-create':
        case 'product.create':
        case 'product-update':
        case 'product.update':
        case 'product-delete':
        case 'product.delete':
          result = await this.handleProductEvent(eventType, data, context);
          break;

        // Cart
        case 'abandoned-cart':
        case 'cart.abandoned':
          result = await this.handleAbandonedCart(data, context);
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

        // App lifecycle
        case 'app-installed':
        case 'app.installed':
          result = { handled: true, action: eventType };
          this.eventEmitter.emit(eventType, { tenantId, storeId: internalStoreId, raw: data });
          break;
        case 'app-uninstalled':
        case 'app.uninstalled':
          result = await this.handleAppUninstalled(data, context);
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
        await this.orderRepository.update(
          { sallaOrderId: String(data.id), tenantId: context.tenantId },
          { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
        );
      } catch (e) { /* ignore - order may not exist */ }
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
        await this.orderRepository.update(
          { sallaOrderId: String(data.id), tenantId: context.tenantId },
          { status: OrderStatus.REFUNDED },
        );
      } catch (e) { /* ignore */ }
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

  /**
   * ✅ معالجة app.uninstalled
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
        // تحديث الحالة إلى UNINSTALLED using Store entity and enum
        store.status = StoreStatus.UNINSTALLED;
        store.accessToken = undefined;
        store.refreshToken = undefined;
        store.tokenExpiresAt = undefined;
        await this.storeRepository.save(store);

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

    const emitEvent = (eventType === 'product-create' || eventType === 'product.create') ? 'product.created'
      : (eventType === 'product-delete' || eventType === 'product.delete') ? 'product.deleted'
      : 'product.updated';

    this.eventEmitter.emit(emitEvent, {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName: data.name,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: eventType, productId: data.id, emittedEvent: emitEvent };
  }

  private async handleAbandonedCart(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid abandoned-cart', { cartId: data.id });

    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer?.id) await this.syncCustomerToDatabase(customer, context);

    this.eventEmitter.emit('cart.abandoned', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      cartId: data.id,
      customerName: customer?.name,
      customerPhone: customer?.mobile,
      cartTotal: data.total,
      items: data.items,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'abandoned_cart', cartId: data.id };
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
      const sallaOrderId = String(data.id);
      let order = await this.orderRepository.findOne({
        where: { sallaOrderId, storeId: context.storeId },
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
          sallaOrderId,
          referenceId: (data.code as string) || (data.invoice_number as string) || (data.order_number as string) || undefined,
          status: this.mapZidOrderStatus(data.order_status || data.status),
          totalAmount,
          subtotal: Number(data.sub_total || totalAmount) || 0,
          currency: String(data.currency_code || data.currency || 'SAR'),
          items: items as any,
          metadata: { source: 'zid', sallaData: data } as any,
        });
      } else {
        order.status = this.mapZidOrderStatus(data.order_status || data.status);
        order.totalAmount = totalAmount || order.totalAmount;
        if (customerId) order.customerId = customerId;
        if (items.length > 0) order.items = items as any;
        order.metadata = { ...(order.metadata || {}), source: 'zid', sallaData: data } as any;
      }

      return await this.orderRepository.save(order);
    } catch (error) {
      this.logger.error(`Failed to sync Zid order ${data.id}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  private async updateOrderStatusInDatabase(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string },
  ): Promise<void> {
    if (!context.storeId || !data.id) return;

    try {
      const sallaOrderId = String(data.id);
      const order = await this.orderRepository.findOne({
        where: { sallaOrderId, storeId: context.storeId },
      });

      if (!order) {
        this.logger.warn(`⚠️ Zid order ${sallaOrderId} not in DB - creating`);
        await this.syncOrderToDatabase(data, context);
        return;
      }

      order.status = this.mapZidOrderStatus(data.order_status || data.status);
      order.metadata = { ...(order.metadata || {}), source: 'zid', sallaData: { ...(order.metadata?.sallaData || {}), lastWebhookData: data } } as any;
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
      const sallaCustomerId = String(data.id);
      let customer = await this.customerRepository.findOne({
        where: { sallaCustomerId, storeId: context.storeId },
      });

      // Zid sends name as single field, not first_name/last_name
      const fullName = String(data.name || '');
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || String(data.first_name || '');
      const lastName = nameParts.slice(1).join(' ') || String(data.last_name || '');
      const phone = (data.mobile as string) || (data.phone as string) || undefined;
      const email = (data.email as string) || undefined;

      if (!customer) {
        customer = this.customerRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          sallaCustomerId,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          fullName: fullName || (firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined),
          email,
          phone,
          status: CustomerStatus.ACTIVE,
          metadata: { source: 'zid', sallaData: data } as any,
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
        customer.metadata = { ...(customer.metadata || {}), source: 'zid', sallaData: data } as any;
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
  private mapZidStatusToEvent(statusSlug: string): string | null {
    const map: Record<string, string> = {
      // ═══ حالات بالإنجليزي ═══
      
      // طلب جديد
      'new': 'order.created',
      'pending': 'order.created',
      'created': 'order.created',

      // قيد التنفيذ
      'processing': 'order.status.processing',
      'confirmed': 'order.status.processing',
      'in_progress': 'order.status.processing',
      'accepted': 'order.status.processing',
      'preparing': 'order.status.processing',
      'preparation': 'order.status.processing',

      // جاهز للشحن
      'ready': 'order.status.ready_to_ship',
      'ready_to_ship': 'order.status.ready_to_ship',
      'ready_for_pickup': 'order.status.ready_to_ship',

      // تم الشحن
      'shipped': 'order.shipped',
      'shipping': 'order.shipped',

      // جاري التوصيل
      'indelivery': 'order.status.in_transit',
      'in_delivery': 'order.status.in_transit',
      'in_transit': 'order.status.in_transit',
      'out_for_delivery': 'order.status.in_transit',
      'delivering': 'order.status.in_transit',
      'on_the_way': 'order.status.in_transit',

      // تم التوصيل
      'delivered': 'order.delivered',

      // مكتمل
      'completed': 'order.status.completed',
      'complete': 'order.status.completed',
      'done': 'order.status.completed',

      // ملغي
      'cancelled': 'order.cancelled',
      'canceled': 'order.cancelled',

      // مسترجع
      'refunded': 'order.refunded',
      'refund': 'order.refunded',

      // معلق
      'on_hold': 'order.status.on_hold',
      'hold': 'order.status.on_hold',
      'holded': 'order.status.on_hold',

      // مدفوع
      'paid': 'order.status.paid',
      'payment_received': 'order.status.paid',

      // بانتظار الدفع
      'pending_payment': 'order.status.pending_payment',
      'awaiting_payment': 'order.status.pending_payment',
      'unpaid': 'order.status.pending_payment',

      // بانتظار المراجعة
      'under_review': 'order.status.under_review',
      'awaiting_review': 'order.status.under_review',
      'review': 'order.status.under_review',

      // استرداد
      'restoring': 'order.status.restoring',
      'restored': 'order.status.restoring',

      // ═══ حالات بالعربي (زد يرسل order_status كنص عربي) ═══
      'جديد': 'order.created',
      'بانتظار المراجعة': 'order.status.under_review',
      'قيد التنفيذ': 'order.status.processing',
      'جاهز': 'order.status.ready_to_ship',
      'تم الشحن': 'order.shipped',
      'جاري التوصيل': 'order.status.in_transit',
      'تم التوصيل': 'order.delivered',
      'مكتمل': 'order.status.completed',
      'ملغي': 'order.cancelled',
      'مسترجع': 'order.refunded',
      'قيد الاسترجاع': 'order.status.restoring',
      'معلق': 'order.status.on_hold',
      'مدفوع': 'order.status.paid',
      'بانتظار الدفع': 'order.status.pending_payment',
      'تم التنفيذ': 'order.status.completed',
    };

    return map[statusSlug] || null;
  }

  private mapZidOrderStatus(status: unknown): OrderStatus {
    const statusStr = this.extractZidStatusSlug(status);

    const statusMap: Record<string, OrderStatus> = {
      // English
      'new': OrderStatus.CREATED,
      'pending': OrderStatus.CREATED,
      'confirmed': OrderStatus.PROCESSING,
      'processing': OrderStatus.PROCESSING,
      'ready': OrderStatus.READY_TO_SHIP,
      'ready_to_ship': OrderStatus.READY_TO_SHIP,
      'shipped': OrderStatus.SHIPPED,
      'in_transit': OrderStatus.SHIPPED,
      'in_delivery': OrderStatus.SHIPPED,
      'delivered': OrderStatus.DELIVERED,
      'cancelled': OrderStatus.CANCELLED,
      'canceled': OrderStatus.CANCELLED,
      'refunded': OrderStatus.REFUNDED,
      'completed': OrderStatus.COMPLETED,
      'on_hold': OrderStatus.ON_HOLD,
      'paid': OrderStatus.PAID,
      'failed': OrderStatus.FAILED,
      // Arabic
      'جديد': OrderStatus.CREATED,
      'قيد التنفيذ': OrderStatus.PROCESSING,
      'جاهز': OrderStatus.READY_TO_SHIP,
      'تم الشحن': OrderStatus.SHIPPED,
      'جاري التوصيل': OrderStatus.SHIPPED,
      'تم التوصيل': OrderStatus.DELIVERED,
      'مكتمل': OrderStatus.COMPLETED,
      'تم التنفيذ': OrderStatus.COMPLETED,
      'ملغي': OrderStatus.CANCELLED,
      'مسترجع': OrderStatus.REFUNDED,
      'معلق': OrderStatus.ON_HOLD,
      'مدفوع': OrderStatus.PAID,
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
