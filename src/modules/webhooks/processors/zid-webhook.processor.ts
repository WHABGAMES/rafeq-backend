/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Zid Webhook Processor                            ║
 * ║                                                                                ║
 * ║  ✅ v1: Production-ready                                                       ║
 * ║  يعالج أحداث زد من الـ Queue ويحدّث قاعدة البيانات                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ZidWebhooksService } from '../zid-webhooks.service';
import { WebhookStatus, ZidEventType } from '@database/entities/webhook-event.entity';
import { WebhookLogAction } from '../entities/webhook-log.entity';
import { Order, OrderStatus } from '@database/entities/order.entity';
import { Customer, CustomerStatus } from '@database/entities/customer.entity';

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
        // Orders
        case ZidEventType.ORDER_NEW:
          result = await this.handleNewOrder(data, context);
          break;
        case ZidEventType.ORDER_UPDATE:
        case ZidEventType.ORDER_STATUS_UPDATE:
          result = await this.handleOrderUpdate(data, context);
          break;
        case ZidEventType.ORDER_CANCELLED:
          result = await this.handleOrderCancelled(data, context);
          break;
        case ZidEventType.ORDER_REFUNDED:
          result = await this.handleOrderRefunded(data, context);
          break;

        // Customers
        case ZidEventType.CUSTOMER_NEW:
          result = await this.handleNewCustomer(data, context);
          break;
        case ZidEventType.CUSTOMER_UPDATE:
          result = await this.handleCustomerUpdate(data, context);
          break;

        // Products
        case ZidEventType.PRODUCT_CREATE:
        case ZidEventType.PRODUCT_UPDATE:
        case ZidEventType.PRODUCT_DELETE:
          result = await this.handleProductEvent(eventType, data, context);
          break;

        // Cart
        case ZidEventType.ABANDONED_CART:
          result = await this.handleAbandonedCart(data, context);
          break;

        // Reviews
        case ZidEventType.NEW_REVIEW:
          result = await this.handleNewReview(data, context);
          break;

        // Inventory
        case ZidEventType.INVENTORY_LOW:
          result = await this.handleInventoryLow(data, context);
          break;

        // App
        case ZidEventType.APP_INSTALLED:
        case ZidEventType.APP_UNINSTALLED:
          result = { handled: true, action: eventType };
          this.eventEmitter.emit(eventType, { tenantId, storeId: internalStoreId, raw: data });
          break;

        default:
          this.logger.warn(`Unknown Zid event type: ${eventType}`);
          result = { handled: false, action: 'unknown_event', eventType };
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
    this.logger.log('Processing Zid new-order', { orderId: data.id });

    // حفظ الطلب في قاعدة البيانات
    if (context.tenantId && data.id) {
      await this.syncOrderToDatabase(data, context);
    }

    // حفظ العميل إذا موجود
    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer?.id) {
      await this.syncCustomerToDatabase(customer, context);
    }

    this.eventEmitter.emit('order.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      orderNumber: data.order_number,
      total: data.total,
      customerName: customer?.name,
      customerPhone: customer?.mobile,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'new_order', orderId: data.id, emittedEvent: 'order.created' };
  }

  private async handleOrderUpdate(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing Zid order-update', { orderId: data.id });

    if (context.tenantId && data.id) {
      await this.updateOrderStatusInDatabase(data, context);
    }

    this.eventEmitter.emit('order.status.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      status: data.status,
      raw: data,
      source: 'zid',
    });

    return { handled: true, action: 'order_update', orderId: data.id, emittedEvent: 'order.status.updated' };
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
  // 📦 Product / Cart / Review / Inventory Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleProductEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log(`Processing Zid ${eventType}`, { productId: data.id });

    const emitEvent = eventType === ZidEventType.PRODUCT_CREATE ? 'product.created'
      : eventType === ZidEventType.PRODUCT_DELETE ? 'product.deleted'
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
  ): Promise<Order | null> {
    if (!context.tenantId || !data.id) return null;

    try {
      const orderId = String(data.id);
      let order = await this.orderRepository.findOne({
        where: { sallaOrderId: orderId, tenantId: context.tenantId },
      });

      const customer = data.customer as Record<string, unknown> | undefined;
      const items = (data.items as Record<string, unknown>[] | undefined) || [];

      if (!order) {
        order = this.orderRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          sallaOrderId: orderId,
          orderNumber: String(data.order_number || data.reference_id || orderId),
          status: this.mapZidOrderStatus(data.status),
          totalAmount: Number(data.total) || 0,
          currency: String(data.currency || 'SAR'),
          customerName: customer?.name ? String(customer.name) : undefined,
          customerEmail: customer?.email ? String(customer.email) : undefined,
          customerPhone: customer?.mobile ? String(customer.mobile) : undefined,
          itemsCount: items.length,
          rawData: data,
          source: 'zid',
        });
      } else {
        order.status = this.mapZidOrderStatus(data.status);
        order.totalAmount = Number(data.total) || order.totalAmount;
        order.rawData = data;
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
    if (!context.tenantId || !data.id) return;

    try {
      await this.orderRepository.update(
        { sallaOrderId: String(data.id), tenantId: context.tenantId },
        {
          status: this.mapZidOrderStatus(data.status),
          rawData: data,
        },
      );
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
    if (!context.tenantId || !data.id) return null;

    try {
      const customerId = String(data.id);
      let customer = await this.customerRepository.findOne({
        where: { sallaCustomerId: customerId, tenantId: context.tenantId },
      });

      // Zid sends name as single field, not first_name/last_name
      const fullName = String(data.name || '');
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      if (!customer) {
        customer = this.customerRepository.create({
          tenantId: context.tenantId,
          storeId: context.storeId,
          sallaCustomerId: customerId,
          firstName: firstName || String(data.first_name || ''),
          lastName: lastName || String(data.last_name || ''),
          email: data.email ? String(data.email) : undefined,
          phone: data.mobile ? String(data.mobile) : (data.phone ? String(data.phone) : undefined),
          // Note: city/country stored in shipping address, not Customer entity
          status: CustomerStatus.ACTIVE,
          source: 'zid',
        });
      } else {
        if (firstName) customer.firstName = firstName;
        if (lastName) customer.lastName = lastName;
        if (data.email) customer.email = String(data.email);
        if (data.mobile || data.phone) customer.phone = String(data.mobile || data.phone);
        // Note: city/country stored in shipping address, not Customer entity
      }

      return await this.customerRepository.save(customer);
    } catch (error) {
      this.logger.error(`Failed to sync Zid customer ${data.id}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  private mapZidOrderStatus(status: unknown): OrderStatus {
    const statusStr = typeof status === 'string' ? status.toLowerCase()
      : typeof status === 'object' && status !== null ? String((status as Record<string, unknown>).slug || (status as Record<string, unknown>).name || '') .toLowerCase()
      : '';

    const statusMap: Record<string, OrderStatus> = {
      'new': OrderStatus.CREATED,
      'pending': OrderStatus.CREATED,
      'confirmed': OrderStatus.PROCESSING,
      'processing': OrderStatus.PROCESSING,
      'shipped': OrderStatus.SHIPPED,
      'delivered': OrderStatus.DELIVERED,
      'cancelled': OrderStatus.CANCELLED,
      'refunded': OrderStatus.REFUNDED,
      'completed': OrderStatus.COMPLETED,
      'on_hold': OrderStatus.ON_HOLD,
      'paid': OrderStatus.PAID,
      'ready_to_ship': OrderStatus.READY_TO_SHIP,
      'failed': OrderStatus.FAILED,
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
