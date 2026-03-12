/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Salla Webhook Processor                          ║
 * ║                                                                                ║
 * ║  ✅ v6: FIX #8 — God Class Split                                              ║
 * ║    • Heavy business logic delegated to SallaOrderHandler + SallaMiscHandler   ║
 * ║    • Processor retains only: orchestration, error handling, communication     ║
 * ║    • Reduced from 1629 → ~280 lines (83% reduction)                          ║
 * ║                                                                                ║
 * ║  ✅ v5: Security & Stability Fixes                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SallaWebhooksService } from '../salla-webhooks.service';
import { WebhookStatus, SallaEventType } from '@database/entities/webhook-event.entity';
import { WebhookLogAction } from '../entities/webhook-log.entity';
import { CommunicationEventType } from '../dto/salla-webhook.dto';
import { SallaOrderHandler } from './salla/salla-order.handler';
import { SallaMiscHandler } from './salla/salla-misc.handler';

interface SallaWebhookJobData {
  webhookEventId: string;
  eventType: string;
  merchant: number;
  data: Record<string, unknown>;
  tenantId?: string;
  storeId?: string;
  isRetry?: boolean;
}

@Processor('salla-webhooks')
export class SallaWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(SallaWebhookProcessor.name);

  constructor(
    private readonly sallaWebhooksService: SallaWebhooksService,
    private readonly eventEmitter: EventEmitter2,
    private readonly orderHandler: SallaOrderHandler,
    private readonly miscHandler: SallaMiscHandler,
  ) {
    super();
  }

  async process(job: Job<SallaWebhookJobData>): Promise<void> {
    const startTime = Date.now();
    const { webhookEventId, eventType, data, tenantId, storeId } = job.data;

    this.logger.warn(`🚀 JOB START: ${eventType}`, {
      jobId:    job.id,
      webhookEventId,
      tenantId: tenantId || '❌ MISSING',
      storeId:  storeId  || '❌ MISSING',
      attempt:  job.attemptsMade + 1,
      dataKeys: Object.keys(data || {}).join(','),
    });

    try {
      await this.sallaWebhooksService.updateStatus(webhookEventId, WebhookStatus.PROCESSING);
      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_STARTED,
        previousStatus: WebhookStatus.PENDING,
        newStatus: WebhookStatus.PROCESSING,
        attemptNumber: job.attemptsMade + 1,
      });

      const result = await this.handleEvent(eventType, data, { tenantId, storeId, webhookEventId });
      const dur = Date.now() - startTime;

      await this.sallaWebhooksService.updateStatus(webhookEventId, WebhookStatus.PROCESSED, {
        processingResult: result,
        processingDurationMs: dur,
      });
      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSED,
        previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.PROCESSED,
        message: `Processed in ${dur}ms`,
        durationMs: dur,
        metadata: result,
      });

      this.eventEmitter.emit(`salla.${eventType}`, { webhookEventId, tenantId, storeId, data, result });
      this.eventEmitter.emit('webhook.processed', { webhookEventId, eventType, tenantId, storeId, data });

      this.logger.log(`✅ Webhook processed: ${eventType} in ${dur}ms`, { jobId: job.id, webhookEventId });

    } catch (error) {
      const dur = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack   = error instanceof Error ? error.stack   : undefined;

      this.logger.error(`❌ Webhook failed: ${eventType}`, { jobId: job.id, webhookEventId, error: errorMessage });

      const attempts = await this.sallaWebhooksService.incrementAttempts(webhookEventId);
      await this.sallaWebhooksService.updateStatus(webhookEventId, WebhookStatus.FAILED, {
        errorMessage,
        processingDurationMs: dur,
      });
      await this.sallaWebhooksService.createLog(webhookEventId, tenantId, {
        action: WebhookLogAction.PROCESSING_FAILED,
        previousStatus: WebhookStatus.PROCESSING,
        newStatus: WebhookStatus.FAILED,
        message: errorMessage,
        errorDetails: { stack: errorStack },
        durationMs: dur,
        attemptNumber: attempts,
      });

      throw error;
    }
  }

  // ─── Event Router ─────────────────────────────────────────────────────────

  private async handleEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {
    switch (eventType) {
      // Order events
      case SallaEventType.ORDER_CREATED:         return this.orderHandler.handleOrderCreated(data, context);
      case SallaEventType.ORDER_UPDATED:         return this.orderHandler.handleOrderUpdated(data, context);
      case SallaEventType.ORDER_STATUS_UPDATED:  return this.orderHandler.handleOrderStatusUpdated(data, context);
      case SallaEventType.ORDER_PAYMENT_UPDATED: return this.orderHandler.handleOrderPaymentUpdated(data, context);
      case SallaEventType.ORDER_SHIPPED:         return this.orderHandler.handleOrderShipped(data, context);
      case SallaEventType.ORDER_DELIVERED:       return this.orderHandler.handleOrderDelivered(data, context);
      case SallaEventType.ORDER_CANCELLED:       return this.orderHandler.handleOrderCancelled(data, context);
      case SallaEventType.ORDER_REFUNDED:        return this.orderHandler.handleOrderRefunded(data, context);

      // Customer / Cart / Shipment / Product / Review / App events
      case SallaEventType.CUSTOMER_CREATED:      return this.miscHandler.handleCustomerCreated(data, context);
      case SallaEventType.CUSTOMER_UPDATED:      return this.miscHandler.handleCustomerUpdated(data, context);
      case SallaEventType.CUSTOMER_OTP_REQUEST:  return this.miscHandler.handleCustomerOtpRequest(data, context);
      case SallaEventType.ABANDONED_CART:        return this.miscHandler.handleAbandonedCart(data, context);
      case SallaEventType.SHIPMENT_CREATED:      return this.miscHandler.handleShipmentCreated(data, context);
      case SallaEventType.TRACKING_REFRESHED:    return this.miscHandler.handleTrackingRefreshed(data, context);
      case SallaEventType.PRODUCT_AVAILABLE:     return this.miscHandler.handleProductAvailable(data, context);
      case SallaEventType.PRODUCT_QUANTITY_LOW:  return this.miscHandler.handleProductQuantityLow(data, context);
      case SallaEventType.PRODUCT_CREATED:       return this.miscHandler.handleProductCreated(data, context);
      case SallaEventType.REVIEW_ADDED:          return this.miscHandler.handleReviewAdded(data, context);
      case SallaEventType.INVOICE_CREATED:       return this.miscHandler.handleInvoiceCreated(data, context);
      case SallaEventType.APP_INSTALLED:         return this.miscHandler.handleAppInstalled(data, context);
      case SallaEventType.APP_UNINSTALLED:       return this.miscHandler.handleAppUninstalled(data, context);

      // Communication webhooks (Salla Communication App — relay only)
      case SallaEventType.COMMUNICATION_WHATSAPP_SEND:
        return this.handleCommunicationEvent('whatsapp', data, context);
      case SallaEventType.COMMUNICATION_SMS_SEND:
        return this.handleCommunicationEvent('sms', data, context);
      case SallaEventType.COMMUNICATION_EMAIL_SEND:
        return this.handleCommunicationEvent('email', data, context);

      default:
        this.logger.warn(`Unhandled event: ${eventType}`);
        return { handled: false, eventType };
    }
  }

  // ─── Communication Relay ──────────────────────────────────────────────────
  // Kept in processor intentionally: pure Salla-protocol relay with no
  // business logic — not worth a separate handler class.

  private async handleCommunicationEvent(
    channelType: 'whatsapp' | 'sms' | 'email',
    data: Record<string, unknown>,
    context: { tenantId?: string; storeId?: string; webhookEventId: string },
  ): Promise<Record<string, unknown>> {

    const notifiable = Array.isArray(data.notifiable)
      ? (data.notifiable as string[]).filter(Boolean)
      : [];

    const content    = typeof data.content === 'string' ? data.content.trim() : '';
    const rawType    = typeof data.type    === 'string' ? data.type.trim()    : '';
    const entity     = data.entity as { id: number | string; type: string } | null | undefined;
    const meta       = data.meta   as Record<string, unknown>               | null | undefined;
    const customerId = meta?.customer_id ? Number(meta.customer_id) : undefined;
    const otpCode    = meta?.code ? String(meta.code) : undefined;

    const normalizedRawType = rawType === 'otp'
      ? CommunicationEventType.AUTH_OTP_VERIFICATION
      : rawType;

    const validBusinessTypes = Object.values(CommunicationEventType) as string[];
    const isKnownType  = validBusinessTypes.includes(normalizedRawType);
    const businessType = normalizedRawType || 'unknown';

    if (!isKnownType && rawType) {
      this.logger.warn(`⚠️ Communication ${channelType}: unknown businessType "${rawType}" — processing anyway.`);
    }

    this.logger.log(`📡 Communication ${channelType}: type=${businessType}, recipients=${notifiable.length}`, {
      tenantId:       context.tenantId || '❌ MISSING',
      storeId:        context.storeId  || '❌ MISSING',
      isKnownType,
      contentPreview: content.substring(0, 60),
    });

    if (!context.tenantId) {
      throw new Error(
        `Communication ${channelType} [${businessType}]: tenantId missing — ` +
        `store not linked to tenant yet. Ensure app.store.authorize was processed.`,
      );
    }

    if (!notifiable.length) {
      this.logger.warn(`⚠️ Communication ${channelType} [${businessType}]: no recipients — skipping`);
      return { handled: false, reason: 'no_recipients', channelType, businessType };
    }

    if (!content) {
      this.logger.warn(`⚠️ Communication ${channelType} [${businessType}]: empty content — skipping`);
      return { handled: false, reason: 'empty_content', channelType, businessType };
    }

    // Campaign bulk protection
    const BULK_THRESHOLD = 50;
    if (
      businessType === CommunicationEventType.MARKETING_CAMPAIGN_BROADCAST &&
      notifiable.length > BULK_THRESHOLD
    ) {
      const batches: string[][] = [];
      for (let i = 0; i < notifiable.length; i += BULK_THRESHOLD) {
        batches.push(notifiable.slice(i, i + BULK_THRESHOLD));
      }

      for (const [batchIndex, batch] of batches.entries()) {
        this.eventEmitter.emit(`communication.relay.${channelType}`, {
          tenantId: context.tenantId, storeId: context.storeId,
          webhookEventId: context.webhookEventId, channelType, notifiable: batch,
          content, businessType, entity: null, customerId: undefined, otpCode: undefined,
          isBatch: true, batchIndex, totalBatches: batches.length, raw: data,
        });
      }

      this.logger.log(`✅ Campaign broadcast split into ${batches.length} batches`, {
        totalRecipients: notifiable.length,
      });

      return {
        handled: true, action: `communication_${channelType}_campaign_batched`,
        channelType, businessType,
        totalRecipients: notifiable.length, batches: batches.length,
      };
    }

    this.eventEmitter.emit(`communication.relay.${channelType}`, {
      tenantId: context.tenantId, storeId: context.storeId,
      webhookEventId: context.webhookEventId, channelType, notifiable, content,
      businessType, entity: entity ?? null, customerId, otpCode, raw: data,
    });

    this.logger.log(
      `✅ Communication ${channelType} relayed: [${businessType}] → ${notifiable.length} recipient(s)`,
      { entityId: entity?.id ?? null, customerId: customerId ?? null },
    );

    return {
      handled: true, action: `communication_${channelType}_relay`,
      channelType, businessType, recipients: notifiable.length,
      entityType: entity?.type ?? null, entityId: entity?.id ?? null,
      customerId: customerId ?? null, isKnownType,
    };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SallaWebhookJobData>, err: Error): void {
    this.logger.error(
      `💀 Job permanently failed after ${job.attemptsMade} attempts: ${job.data.eventType}`,
      { jobId: job.id, error: err.message },
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<SallaWebhookJobData>): void {
    this.logger.debug(`✅ Job completed: ${job.data.eventType}`, { jobId: job.id });
  }
}
