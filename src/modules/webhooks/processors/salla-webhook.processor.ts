/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Salla Webhook Processor                          ║
 * ║                                                                                ║
 * ║  ✅ إصلاح: تنفيذ معالجات حقيقية لأحداث Salla بدلاً من log فقط                 ║
 * ║  - كل handler يطلق event مناسب عبر EventEmitter2                              ║
 * ║  - الخدمات الأخرى تستمع للأحداث وتتعامل معها                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Services
import { SallaWebhooksService } from '../salla-webhooks.service';

// ✅ Entities - Import from database (single source of truth)
import { WebhookStatus, SallaEventType } from '@database/entities/webhook-event.entity';
import { WebhookLogAction } from '../entities/webhook-log.entity';

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
  limiter: {
    max: 100,
    duration: 1000,
  },
})
export class SallaWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(SallaWebhookProcessor.name);

  constructor(
    private readonly sallaWebhooksService: SallaWebhooksService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<SallaWebhookJobData>): Promise<void> {
    const startTime = Date.now();
    const { webhookEventId, eventType, data, tenantId, storeId } = job.data;

    this.logger.log(`🔄 Processing webhook: ${eventType}`, {
      jobId: job.id,
      webhookEventId,
      attempt: job.attemptsMade + 1,
    });

    try {
      await this.sallaWebhooksService.updateStatus(
        webhookEventId,
        WebhookStatus.PROCESSING,
      );

      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_STARTED,
        previousStatus: WebhookStatus.PENDING,
        newStatus: WebhookStatus.PROCESSING,
        attemptNumber: job.attemptsMade + 1,
      });

      const result = await this.handleEvent(eventType, data, {
        tenantId,
        storeId,
        webhookEventId,
      });

      const processingDuration = Date.now() - startTime;

      await this.sallaWebhooksService.updateStatus(
        webhookEventId,
        WebhookStatus.PROCESSED,
        {
          processingResult: result,
          processingDurationMs: processingDuration,
        },
      );

      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSED,
        previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.PROCESSED,
        message: `Successfully processed in ${processingDuration}ms`,
        durationMs: processingDuration,
        metadata: result,
      });

      this.eventEmitter.emit(`salla.${eventType}`, {
        webhookEventId,
        tenantId,
        storeId,
        data,
        result,
      });

      this.logger.log(`✅ Webhook processed: ${eventType} in ${processingDuration}ms`, {
        jobId: job.id,
        webhookEventId,
      });

    } catch (error) {
      const processingDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`❌ Webhook processing failed: ${eventType}`, {
        jobId: job.id,
        webhookEventId,
        error: errorMessage,
        attempt: job.attemptsMade + 1,
      });

      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_FAILED,
        previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.FAILED,
        message: errorMessage,
        errorDetails: {
          message: errorMessage,
          stack: errorStack,
          attempt: job.attemptsMade + 1,
        },
        durationMs: processingDuration,
        attemptNumber: job.attemptsMade + 1,
      });

      await this.sallaWebhooksService.incrementAttempts(webhookEventId);

      throw error;
    }
  }

  private async handleEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    switch (eventType) {
      case SallaEventType.ORDER_CREATED:
        return this.handleOrderCreated(data, context);

      case SallaEventType.ORDER_STATUS_UPDATED:
        return this.handleOrderStatusUpdated(data, context);

      case SallaEventType.ORDER_PAYMENT_UPDATED:
        return this.handleOrderPaymentUpdated(data, context);

      case SallaEventType.ORDER_SHIPPED:
        return this.handleOrderShipped(data, context);

      case SallaEventType.ORDER_DELIVERED:
        return this.handleOrderDelivered(data, context);

      case SallaEventType.ORDER_CANCELLED:
        return this.handleOrderCancelled(data, context);

      case SallaEventType.CUSTOMER_CREATED:
        return this.handleCustomerCreated(data, context);

      case SallaEventType.CUSTOMER_UPDATED:
        return this.handleCustomerUpdated(data, context);

      case SallaEventType.ABANDONED_CART:
        return this.handleAbandonedCart(data, context);

      case SallaEventType.SHIPMENT_CREATED:
        return this.handleShipmentCreated(data, context);

      case SallaEventType.TRACKING_REFRESHED:
        return this.handleTrackingRefreshed(data, context);

      case SallaEventType.PRODUCT_AVAILABLE:
        return this.handleProductAvailable(data, context);

      case SallaEventType.PRODUCT_QUANTITY_LOW:
        return this.handleProductQuantityLow(data, context);

      case SallaEventType.REVIEW_ADDED:
        return this.handleReviewAdded(data, context);

      case SallaEventType.APP_INSTALLED:
        return this.handleAppInstalled(data, context);

      case SallaEventType.APP_UNINSTALLED:
        return this.handleAppUninstalled(data, context);

      default:
        this.logger.warn(`Unhandled event type: ${eventType}`);
        return { handled: false, eventType };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Order Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleOrderCreated(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.created', { orderId: data.id, storeId: context.storeId });

    // إطلاق حدث لمعالجة الطلب الجديد
    this.eventEmitter.emit('order.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      orderNumber: data.reference_id || data.order_number,
      customerName: (data.customer as Record<string, unknown>)?.first_name,
      customerPhone: (data.customer as Record<string, unknown>)?.mobile,
      totalAmount: data.total,
      currency: data.currency,
      items: data.items,
      status: data.status,
      raw: data,
    });

    return {
      handled: true,
      action: 'order_created',
      orderId: data.id,
      emittedEvent: 'order.created',
    };
  }

  private async handleOrderStatusUpdated(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.status.updated', { orderId: data.id, status: data.status });

    this.eventEmitter.emit('order.status.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      newStatus: data.status,
      previousStatus: data.previous_status,
      raw: data,
    });

    return {
      handled: true,
      action: 'order_status_updated',
      orderId: data.id,
      newStatus: data.status,
      emittedEvent: 'order.status.updated',
    };
  }

  private async handleOrderPaymentUpdated(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.payment.updated', { orderId: data.id });

    this.eventEmitter.emit('order.payment.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      paymentStatus: (data.payment as Record<string, unknown>)?.status || data.payment_status,
      paymentMethod: (data.payment as Record<string, unknown>)?.method || data.payment_method,
      raw: data,
    });

    return {
      handled: true,
      action: 'order_payment_updated',
      orderId: data.id,
      emittedEvent: 'order.payment.updated',
    };
  }

  private async handleOrderShipped(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.shipped', { orderId: data.id });

    this.eventEmitter.emit('order.shipped', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      trackingNumber: data.tracking_number,
      shippingCompany: data.shipping_company,
      raw: data,
    });

    return {
      handled: true,
      action: 'order_shipped',
      orderId: data.id,
      emittedEvent: 'order.shipped',
    };
  }

  private async handleOrderDelivered(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.delivered', { orderId: data.id });

    this.eventEmitter.emit('order.delivered', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      raw: data,
    });

    return {
      handled: true,
      action: 'order_delivered',
      orderId: data.id,
      emittedEvent: 'order.delivered',
    };
  }

  private async handleOrderCancelled(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.cancelled', { orderId: data.id });

    this.eventEmitter.emit('order.cancelled', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      orderId: data.id,
      cancelReason: data.cancel_reason,
      raw: data,
    });

    return {
      handled: true,
      action: 'order_cancelled',
      orderId: data.id,
      emittedEvent: 'order.cancelled',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Customer Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleCustomerCreated(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.created', { customerId: data.id });

    this.eventEmitter.emit('customer.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      mobile: data.mobile,
      raw: data,
    });

    return {
      handled: true,
      action: 'customer_created',
      customerId: data.id,
      emittedEvent: 'customer.created',
    };
  }

  private async handleCustomerUpdated(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.updated', { customerId: data.id });

    this.eventEmitter.emit('customer.updated', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      customerId: data.id,
      raw: data,
    });

    return {
      handled: true,
      action: 'customer_updated',
      customerId: data.id,
      emittedEvent: 'customer.updated',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Cart Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleAbandonedCart(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing abandoned.cart', { cartId: data.id });

    this.eventEmitter.emit('cart.abandoned', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      cartId: data.id,
      customerName: (data.customer as Record<string, unknown>)?.first_name,
      customerPhone: (data.customer as Record<string, unknown>)?.mobile,
      customerEmail: (data.customer as Record<string, unknown>)?.email,
      cartTotal: data.total,
      items: data.items,
      raw: data,
    });

    return {
      handled: true,
      action: 'abandoned_cart',
      cartId: data.id,
      emittedEvent: 'cart.abandoned',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Shipment Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleShipmentCreated(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing shipment.created', { shipmentId: data.id });

    this.eventEmitter.emit('shipment.created', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      shipmentId: data.id,
      orderId: data.order_id,
      trackingNumber: data.tracking_number,
      shippingCompany: data.shipping_company,
      raw: data,
    });

    return {
      handled: true,
      action: 'shipment_created',
      shipmentId: data.id,
      emittedEvent: 'shipment.created',
    };
  }

  private async handleTrackingRefreshed(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing tracking.refreshed', { orderId: data.id });

    this.eventEmitter.emit('tracking.refreshed', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      shipmentId: data.id,
      trackingStatus: data.status,
      raw: data,
    });

    return {
      handled: true,
      action: 'tracking_refreshed',
      shipmentId: data.id,
      emittedEvent: 'tracking.refreshed',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 Product Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleProductAvailable(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.available', { productId: data.id });

    this.eventEmitter.emit('product.available', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName: data.name,
      quantity: data.quantity,
      raw: data,
    });

    return {
      handled: true,
      action: 'product_available',
      productId: data.id,
      emittedEvent: 'product.available',
    };
  }

  private async handleProductQuantityLow(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('⚠️ Processing product.quantity.low', { productId: data.id, quantity: data.quantity });

    this.eventEmitter.emit('product.quantity.low', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      productId: data.id,
      productName: data.name,
      currentQuantity: data.quantity,
      raw: data,
    });

    return {
      handled: true,
      action: 'product_quantity_low',
      productId: data.id,
      quantity: data.quantity,
      emittedEvent: 'product.quantity.low',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ⭐ Review Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleReviewAdded(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('Processing review.added', { reviewId: data.id });

    this.eventEmitter.emit('review.added', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      reviewId: data.id,
      productId: data.product_id,
      rating: data.rating,
      content: data.content,
      customerName: data.customer_name,
      raw: data,
    });

    return {
      handled: true,
      action: 'review_added',
      reviewId: data.id,
      rating: data.rating,
      emittedEvent: 'review.added',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 App Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleAppInstalled(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('🎉 Processing app.installed', { merchant: data.merchant });

    this.eventEmitter.emit('app.installed', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      merchant: data.merchant,
      raw: data,
    });

    return {
      handled: true,
      action: 'app_installed',
      merchant: data.merchant,
      emittedEvent: 'app.installed',
    };
  }

  private async handleAppUninstalled(
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    this.logger.log('⚠️ Processing app.uninstalled', { merchant: data.merchant });

    this.eventEmitter.emit('app.uninstalled', {
      tenantId: context.tenantId,
      storeId: context.storeId,
      merchant: data.merchant,
      raw: data,
    });

    return {
      handled: true,
      action: 'app_uninstalled',
      merchant: data.merchant,
      emittedEvent: 'app.uninstalled',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Worker Events
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Job completed: ${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job failed: ${job.id}`, {
      error: error.message,
      attempts: job.attemptsMade,
    });
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job stalled: ${jobId}`);
  }
}
