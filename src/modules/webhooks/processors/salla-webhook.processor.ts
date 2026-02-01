/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Salla Webhook Processor                          ║
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
    _context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    switch (eventType) {
      case SallaEventType.ORDER_CREATED:
        return this.handleOrderCreated(data);

      case SallaEventType.ORDER_STATUS_UPDATED:
        return this.handleOrderStatusUpdated(data);

      case SallaEventType.ORDER_PAYMENT_UPDATED:
        return this.handleOrderPaymentUpdated(data);

      case SallaEventType.ORDER_SHIPPED:
        return this.handleOrderShipped(data);

      case SallaEventType.ORDER_DELIVERED:
        return this.handleOrderDelivered(data);

      case SallaEventType.ORDER_CANCELLED:
        return this.handleOrderCancelled(data);

      case SallaEventType.CUSTOMER_CREATED:
        return this.handleCustomerCreated(data);

      case SallaEventType.CUSTOMER_UPDATED:
        return this.handleCustomerUpdated(data);

      case SallaEventType.ABANDONED_CART:
        return this.handleAbandonedCart(data);

      case SallaEventType.SHIPMENT_CREATED:
        return this.handleShipmentCreated(data);

      case SallaEventType.TRACKING_REFRESHED:
        return this.handleTrackingRefreshed(data);

      case SallaEventType.PRODUCT_AVAILABLE:
        return this.handleProductAvailable(data);

      case SallaEventType.PRODUCT_QUANTITY_LOW:
        return this.handleProductQuantityLow(data);

      case SallaEventType.REVIEW_ADDED:
        return this.handleReviewAdded(data);

      case SallaEventType.APP_INSTALLED:
        return this.handleAppInstalled(data);

      case SallaEventType.APP_UNINSTALLED:
        return this.handleAppUninstalled(data);

      default:
        this.logger.warn(`Unhandled event type: ${eventType}`);
        return { handled: false, eventType };
    }
  }

  // Order Handlers
  private async handleOrderCreated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.created', { orderId: data.id });
    return { handled: true, action: 'order_created', orderId: data.id };
  }

  private async handleOrderStatusUpdated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.status.updated', { orderId: data.id });
    return { handled: true, action: 'order_status_updated', orderId: data.id };
  }

  private async handleOrderPaymentUpdated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.payment.updated', { orderId: data.id });
    return { handled: true, action: 'order_payment_updated', orderId: data.id };
  }

  private async handleOrderShipped(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.shipped', { orderId: data.id });
    return { handled: true, action: 'order_shipped', orderId: data.id };
  }

  private async handleOrderDelivered(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.delivered', { orderId: data.id });
    return { handled: true, action: 'order_delivered', orderId: data.id };
  }

  private async handleOrderCancelled(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing order.cancelled', { orderId: data.id });
    return { handled: true, action: 'order_cancelled', orderId: data.id };
  }

  // Customer Handlers
  private async handleCustomerCreated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.created', { customerId: data.id });
    return { handled: true, action: 'customer_created', customerId: data.id };
  }

  private async handleCustomerUpdated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing customer.updated', { customerId: data.id });
    return { handled: true, action: 'customer_updated', customerId: data.id };
  }

  // Cart Handlers
  private async handleAbandonedCart(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing abandoned.cart', { cartId: data.id });
    return { handled: true, action: 'abandoned_cart', cartId: data.id };
  }

  // Shipment Handlers
  private async handleShipmentCreated(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing shipment.created', { shipmentId: data.id });
    return { handled: true, action: 'shipment_created' };
  }

  private async handleTrackingRefreshed(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing tracking.refreshed', { orderId: data.id });
    return { handled: true, action: 'tracking_refreshed' };
  }

  // Product Handlers
  private async handleProductAvailable(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.available', { productId: data.id });
    return { handled: true, action: 'product_available' };
  }

  private async handleProductQuantityLow(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing product.quantity.low', { productId: data.id });
    return { handled: true, action: 'product_quantity_low' };
  }

  // Review Handlers
  private async handleReviewAdded(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing review.added', { reviewId: data.id });
    return { handled: true, action: 'review_added' };
  }

  // App Handlers
  private async handleAppInstalled(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing app.installed', { merchant: data.merchant });
    return { handled: true, action: 'app_installed', merchant: data.merchant };
  }

  private async handleAppUninstalled(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.logger.log('Processing app.uninstalled', { merchant: data.merchant });
    return { handled: true, action: 'app_uninstalled', merchant: data.merchant };
  }

  // Worker Events
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
