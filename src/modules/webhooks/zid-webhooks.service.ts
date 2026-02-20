/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhooks Service                           ║
 * ║                                                                                ║
 * ║  ✅ Production-ready: ربط zidStoreId → Store → tenantId                       ║
 * ║  نفس بنية SallaWebhooksService مع تعديلات زد                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities
import { WebhookEvent, WebhookSource, WebhookStatus } from '@database/entities/webhook-event.entity';
import { WebhookLog, WebhookLogAction } from './entities/webhook-log.entity';

// Services
import { StoresService } from '../stores/stores.service';

// DTOs
import { ZidWebhookJobDto } from './dto/zid-webhook.dto';

@Injectable()
export class ZidWebhooksService {
  private readonly logger = new Logger(ZidWebhooksService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepository: Repository<WebhookEvent>,

    @InjectRepository(WebhookLog)
    private readonly webhookLogRepository: Repository<WebhookLog>,

    @InjectQueue('zid-webhooks')
    private readonly webhookQueue: Queue,

    private readonly eventEmitter: EventEmitter2,

    private readonly storesService: StoresService,
  ) {}

  async queueWebhook(payload: ZidWebhookJobDto): Promise<string> {
    const startTime = Date.now();

    try {
      // ✅ FIX v2: pass store_uuid as fallback identifier
      const storeUuid = payload.data?.store_uuid as string | undefined;
      const storeInfo = await this.findStoreByZidStoreId(payload.storeId, storeUuid);

      if (!storeInfo) {
        this.logger.warn(`No store found for Zid store ${payload.storeId} - webhook will be saved without tenantId`);
      } else {
        this.logger.debug(`Found store for Zid store ${payload.storeId}: tenantId=${storeInfo.tenantId}`);
      }

      const webhookEvent = this.webhookEventRepository.create({
        tenantId: storeInfo?.tenantId,
        storeId: storeInfo?.storeId,
        source: WebhookSource.ZID,
        eventType: payload.eventType,
        externalId: payload.deliveryId,
        idempotencyKey: payload.idempotencyKey,
        payload: payload.data,
        headers: payload.headers,
        status: WebhookStatus.PENDING,
        ipAddress: payload.ipAddress,
        signature: payload.signature,
        signatureVerified: true,
        relatedEntityId: this.extractEntityId(payload.data),
        relatedEntityType: this.extractEntityType(payload.eventType),
      });

      const savedEvent = await this.webhookEventRepository.save(webhookEvent);

      await this.createLog(savedEvent.id, savedEvent.tenantId, {
        action: WebhookLogAction.RECEIVED,
        newStatus: WebhookStatus.PENDING,
        message: `Zid webhook received: ${payload.eventType}`,
        durationMs: Date.now() - startTime,
      });

      const job = await this.webhookQueue.add(
        payload.eventType,
        {
          webhookEventId: savedEvent.id,
          eventType: payload.eventType,
          storeId: payload.storeId,
          data: payload.data,
          tenantId: storeInfo?.tenantId,
          internalStoreId: storeInfo?.storeId,
        },
        {
          jobId: payload.idempotencyKey,
          priority: this.getEventPriority(payload.eventType),
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.eventEmitter.emit('webhook.received', {
        source: 'zid',
        eventType: payload.eventType,
        webhookEventId: savedEvent.id,
        tenantId: storeInfo?.tenantId,
      });

      this.logger.log(`✅ Zid webhook queued: ${payload.eventType}`, {
        jobId: job.id,
        webhookEventId: savedEvent.id,
        tenantId: storeInfo?.tenantId || 'N/A',
        duration: `${Date.now() - startTime}ms`,
      });

      return job.id as string;

    } catch (error) {
      this.logger.error(`❌ Failed to queue Zid webhook: ${payload.eventType}`, {
        error: error instanceof Error ? error.message : 'Unknown',
        storeId: payload.storeId,
      });
      throw error;
    }
  }

  async checkDuplicate(idempotencyKey: string): Promise<boolean> {
    const existing = await this.webhookEventRepository.findOne({
      where: { idempotencyKey },
      select: ['id'],
    });

    return !!existing;
  }

  async updateStatus(
    webhookEventId: string,
    status: WebhookStatus,
    options?: {
      errorMessage?: string;
      processingResult?: Record<string, unknown>;
      processingDurationMs?: number;
    },
  ): Promise<void> {
    const event = await this.webhookEventRepository.findOne({
      where: { id: webhookEventId },
    });

    if (!event) {
      this.logger.warn(`Webhook event not found: ${webhookEventId}`);
      return;
    }

    event.status = status;

    if (status === WebhookStatus.PROCESSED) {
      event.processedAt = new Date();
    }

    if (options?.errorMessage) {
      event.errorMessage = options.errorMessage;
    }

    if (options?.processingResult) {
      event.processingResult = options.processingResult;
    }

    if (options?.processingDurationMs) {
      event.processingDurationMs = options.processingDurationMs;
    }

    await this.webhookEventRepository.save(event);
  }

  async incrementAttempts(webhookEventId: string): Promise<number> {
    await this.webhookEventRepository.increment(
      { id: webhookEventId },
      'attempts',
      1,
    );

    const event = await this.webhookEventRepository.findOne({
      where: { id: webhookEventId },
      select: ['attempts'],
    });

    return event?.attempts || 1;
  }

  async createLog(
    webhookEventId: string,
    tenantId: string | undefined | null,
    data: {
      action: WebhookLogAction;
      previousStatus?: WebhookStatus;
      newStatus?: WebhookStatus;
      message?: string;
      errorDetails?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      durationMs?: number;
      attemptNumber?: number;
      triggeredBy?: string;
    },
  ): Promise<WebhookLog | null> {
    if (!tenantId) {
      this.logger.warn('Skipping webhook log: tenantId is missing');
      return null;
    }

    const log = this.webhookLogRepository.create({
      webhookEventId,
      tenantId,
      ...data,
    });

    return this.webhookLogRepository.save(log);
  }

  /**
   * ✅ FIX v2: البحث عن المتجر باستخدام zidStoreId أولاً، ثم store_uuid كـ fallback
   * زد يرسل store_id (integer) وأحياناً store_uuid في الـ payload
   */
  private async findStoreByZidStoreId(zidStoreId: string, storeUuid?: string): Promise<{
    tenantId: string;
    storeId: string;
  } | null> {
    this.logger.debug(`Looking up store for Zid store ${zidStoreId}`);

    try {
      // محاولة 1: البحث بـ zidStoreId
      const store = await this.storesService.findByZidStoreId(zidStoreId);

      if (store && store.tenantId) {
        this.logger.debug(`Found store: ${store.id} for Zid store ${zidStoreId}`);
        return { tenantId: store.tenantId, storeId: store.id };
      }

      if (store && !store.tenantId) {
        this.logger.warn(`Store ${store.id} found for Zid store ${zidStoreId} but tenantId is not linked yet`);
      }

      // محاولة 2: البحث بـ store_uuid (fallback)
      if (storeUuid) {
        this.logger.debug(`Trying fallback: lookup by store_uuid ${storeUuid}`);
        const storeByUuid = await this.storesService.findByZidStoreUuid(storeUuid);
        if (storeByUuid && storeByUuid.tenantId) {
          this.logger.debug(`Found store via store_uuid: ${storeByUuid.id}`);
          return { tenantId: storeByUuid.tenantId, storeId: storeByUuid.id };
        }
      }

      this.logger.debug(`No store found for Zid store ${zidStoreId}`);
      return null;

    } catch (error) {
      this.logger.error(`Error looking up store for Zid store ${zidStoreId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  private extractEntityId(data: Record<string, unknown>): string | undefined {
    const id = data.id || data.order_id || data.customer_id || data.product_id;
    return id ? String(id) : undefined;
  }

  private extractEntityType(eventType: string): string | undefined {
    // Zid events: "new-order" → "order", "customer-update" → "customer"
    const parts = eventType.split('-');
    if (parts.length >= 2) {
      // "new-order" → "order", "order-update" → "order"
      return parts.includes('order') ? 'order'
        : parts.includes('customer') ? 'customer'
        : parts.includes('product') ? 'product'
        : parts.includes('cart') ? 'cart'
        : parts.includes('review') ? 'review'
        : parts[0];
    }
    return parts[0] || undefined;
  }

  private getEventPriority(eventType: string): number {
    const priorities: Record<string, number> = {
      'new-order': 1,
      'order-status-update': 2,
      'new-customer': 2,
      'abandoned-cart': 2,
      'order-update': 3,
      'order-cancelled': 3,
      'order-refunded': 3,
      'customer-update': 5,
      'product-create': 6,
      'product-update': 7,
      'new-review': 8,
    };

    return priorities[eventType] || 5;
  }
}
