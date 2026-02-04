/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Salla Webhook Processor                          ║
 * ║                                                                                ║
 * ║  ✅ v4: حفظ الطلبات والعملاء في قاعدة البيانات                                 ║
 * ║  - handleOrderCreated: يحفظ الطلب + العميل في DB ثم يطلق event                 ║
 * ║  - handleCustomerCreated: يحفظ العميل في DB ثم يطلق event                      ║
 * ║  - handleOrderStatusUpdated: يحدّث حالة الطلب في DB ثم يطلق event              ║
 * ║  - Upsert pattern لتجنب التكرار                                                ║
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
        action: WebhookLogAction.FAILED, previousStatus: WebhookStatus.PROCESSING, newStatus: WebhookStatus.FAILED,
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
  // 🗄️ v4: Database Sync
  // ═══════════════════════════════════════════════════════════════════════════════

  private async syncCustomerToDatabase(customerData: Record<string, unknown>, context: { tenantId?: string; storeId?: string }): Promise<Customer | null> {
    if (!context.storeId || !customerData?.id) { this.logger.warn('⚠️ Cannot sync customer: missing storeId or id'); return null; }
    const sallaCustomerId = String(customerData.id);
    try {
      let customer = await this.customerRepository.findOne({ where: { storeId: context.storeId, sallaCustomerId } });
      const firstName = (customerData.first_name as string) || (customerData.name as string) || undefined;
      const lastName = (customerData.last_name as string) || undefined;
      const fullName = firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined;
      const phone = (customerData.mobile as string) || (customerData.phone as string) || undefined;
      const email = (customerData.email as string) || undefined;

      if (customer) {
        if (firstName) customer.firstName = firstName;
        if (lastName) customer.lastName = lastName;
        if (fullName) customer.fullName = fullName;
        if (phone) customer.phone = phone;
        if (email) customer.email = email;
        customer.sallaData = customerData as Record<string, any>;
        customer = await this.customerRepository.save(customer);
        this.logger.log(`🔄 Customer updated: ${sallaCustomerId} (${fullName || 'N/A'})`);
      } else {
        customer = this.customerRepository.create({
          tenantId: context.tenantId, storeId: context.storeId, sallaCustomerId,
          firstName, lastName, fullName, phone, email,
          status: CustomerStatus.ACTIVE, sallaData: customerData as Record<string, any>,
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
      const status = this.mapSallaOrderStatus(orderData.status as string);
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
        order.sallaData = orderData as Record<string, any>;
        order = await this.orderRepository.save(order);
        this.logger.log(`🔄 Order updated: ${sallaOrderId} → ${status}`);
      } else {
        order = this.orderRepository.create({
          tenantId: context.tenantId, storeId: context.storeId, customerId: customerId || undefined,
          sallaOrderId, referenceId: (orderData.reference_id as string) || (orderData.order_number as string) || undefined,
          status, currency: (orderData.currency as string) || 'SAR',
          totalAmount: Number(orderData.total || 0), subtotal: Number(orderData.sub_total || orderData.total || 0),
          items: items as any, sallaData: orderData as Record<string, any>,
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
      order.sallaData = { ...(order.sallaData || {}), lastWebhookData: orderData } as Record<string, any>;
      const saved = await this.orderRepository.save(order);
      this.logger.log(`🔄 Order ${sallaOrderId} → ${newStatus}`);
      return saved;
    } catch (error: unknown) {
      this.logger.error(`❌ Order status update failed ${sallaOrderId}: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  private mapSallaOrderStatus(sallaStatus?: string): OrderStatus {
    if (!sallaStatus) return OrderStatus.CREATED;
    const s = sallaStatus.toLowerCase();
    const map: Record<string, OrderStatus> = {
      'created': OrderStatus.CREATED, 'new': OrderStatus.CREATED, 'pending': OrderStatus.CREATED,
      'processing': OrderStatus.PROCESSING, 'in_progress': OrderStatus.PROCESSING,
      'pending_payment': OrderStatus.PENDING_PAYMENT, 'paid': OrderStatus.PAID,
      'ready_to_ship': OrderStatus.READY_TO_SHIP, 'ready': OrderStatus.READY_TO_SHIP,
      'shipped': OrderStatus.SHIPPED, 'delivering': OrderStatus.SHIPPED,
      'delivered': OrderStatus.DELIVERED, 'completed': OrderStatus.COMPLETED,
      'cancelled': OrderStatus.CANCELLED, 'canceled': OrderStatus.CANCELLED,
      'refunded': OrderStatus.REFUNDED, 'failed': OrderStatus.FAILED, 'on_hold': OrderStatus.ON_HOLD,
      'restored': OrderStatus.PROCESSING,
    };
    const arMap: Record<string, OrderStatus> = {
      'جديد': OrderStatus.CREATED, 'قيد التنفيذ': OrderStatus.PROCESSING, 'قيد المعالجة': OrderStatus.PROCESSING,
      'بانتظار الدفع': OrderStatus.PENDING_PAYMENT, 'مدفوع': OrderStatus.PAID,
      'جاهز للشحن': OrderStatus.READY_TO_SHIP, 'تم الشحن': OrderStatus.SHIPPED,
      'قيد التوصيل': OrderStatus.SHIPPED, 'تم التوصيل': OrderStatus.DELIVERED,
      'مكتمل': OrderStatus.COMPLETED, 'ملغي': OrderStatus.CANCELLED, 'مسترجع': OrderStatus.REFUNDED,
      'فشل': OrderStatus.FAILED, 'معلّق': OrderStatus.ON_HOLD, 'مستعاد': OrderStatus.PROCESSING,
    };
    return map[s] || arMap[sallaStatus] || OrderStatus.PROCESSING;
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
    this.logger.log('Processing order.status.updated', { orderId: data.id, status: data.status });
    const newStatus = this.mapSallaOrderStatus(data.status as string);
    await this.updateOrderStatusInDatabase(data, context, newStatus);
    this.eventEmitter.emit('order.status.updated', { tenantId: context.tenantId, storeId: context.storeId, orderId: data.id, newStatus: data.status, previousStatus: data.previous_status, raw: data });
    return { handled: true, action: 'order_status_updated', orderId: data.id, newStatus: data.status, dbStatus: newStatus, emittedEvent: 'order.status.updated' };
  }

  private async handleOrderPaymentUpdated(data: Record<string, unknown>, context: { tenantId?: string; storeId?: string; webhookEventId: string }): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.payment.updated', { orderId: data.id });
    if (context.storeId && data.id) {
      try {
        const order = await this.orderRepository.findOne({ where: { storeId: context.storeId, sallaOrderId: String(data.id) } });
        if (order) {
          const pd = data.payment as Record<string, unknown>;
          if (pd?.status === 'paid') order.paymentStatus = 'paid' as any;
          order.sallaData = { ...(order.sallaData || {}), lastPaymentWebhook: data } as Record<string, any>;
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
