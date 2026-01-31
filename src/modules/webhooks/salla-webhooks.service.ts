/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Service                         ║
 * ║                                                                                ║
 * ║  ✅ Production-ready: ربط merchantId → Store → tenantId                       ║
 * ║  ✅ Soft-fail: يقبل webhooks حتى لو Store غير موجود                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities
import { WebhookEvent, WebhookSource, WebhookStatus, SallaEventType } from './entities/webhook-event.entity';
import { WebhookLog, WebhookLogAction } from './entities/webhook-log.entity';

// Services
import { StoresService } from '../stores/stores.service';

// DTOs
import { SallaWebhookJobDto } from './dto/salla-webhook.dto';

@Injectable()
export class SallaWebhooksService {
  private readonly logger = new Logger(SallaWebhooksService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepository: Repository<WebhookEvent>,

    @InjectRepository(WebhookLog)
    private readonly webhookLogRepository: Repository<WebhookLog>,

    @InjectQueue('salla-webhooks')
    private readonly webhookQueue: Queue,

    private readonly eventEmitter: EventEmitter2,

    // ✅ إضافة StoresService للبحث عن المتجر
    private readonly storesService: StoresService,
  ) {}

  /**
   * ✅ معالجة Webhook مع soft-fail
   * يقبل الـ webhook حتى لو Store غير موجود
   */
  async queueWebhook(payload: SallaWebhookJobDto): Promise<string> {
    const startTime = Date.now();

    try {
      // ✅ البحث عن المتجر باستخدام merchantId
      const storeInfo = await this.findStoreByMerchantId(payload.merchant);

      // ✅ Soft-fail: لا ترمي error إذا لم يوجد store
      if (!storeInfo) {
        this.logger.warn(
          `⚠️ Webhook ${payload.eventType} received before store link completed for merchant ${payload.merchant}. ` +
          `This is normal if OAuth is still in progress. Webhook will be saved without tenantId.`
        );
      } else {
        this.logger.debug(`Found store for merchant ${payload.merchant}: tenantId=${storeInfo.tenantId}`);
      }

      // ✅ إنشاء webhook event - يقبل null للـ tenantId و storeId
      const webhookEvent = this.webhookEventRepository.create({
        tenantId: storeInfo?.tenantId || null,  // ✅ يقبل null
        storeId: storeInfo?.storeId || null,    // ✅ يقبل null
        source: WebhookSource.SALLA,
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
        // ✅ حفظ merchantId للربط لاحقاً إذا لزم الأمر
        metadata: {
          merchantId: payload.merchant,
          receivedWithoutStore: !storeInfo,
        },
      });

      const savedEvent = await this.webhookEventRepository.save(webhookEvent);

      // إنشاء log (فقط إذا كان هناك tenantId)
      if (storeInfo?.tenantId) {
        await this.createLog(savedEvent.id, storeInfo.tenantId, {
          action: WebhookLogAction.RECEIVED,
          newStatus: WebhookStatus.PENDING,
          message: `Webhook received: ${payload.eventType}`,
          durationMs: Date.now() - startTime,
        });
      }

      // ✅ إضافة للـ queue حتى لو لم يوجد store
      const job = await this.webhookQueue.add(
        payload.eventType,
        {
          webhookEventId: savedEvent.id,
          eventType: payload.eventType,
          merchant: payload.merchant,
          data: payload.data,
          tenantId: storeInfo?.tenantId || null,
          storeId: storeInfo?.storeId || null,
          // ✅ علامة للـ processor لمعرفة أن هذا webhook بدون store
          isUnlinked: !storeInfo,
        },
        {
          jobId: payload.idempotencyKey,
          priority: this.getEventPriority(payload.eventType),
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.eventEmitter.emit('webhook.received', {
        source: 'salla',
        eventType: payload.eventType,
        webhookEventId: savedEvent.id,
        tenantId: storeInfo?.tenantId || null,
        isUnlinked: !storeInfo,
      });

      this.logger.log(`✅ Webhook queued: ${payload.eventType}`, {
        jobId: job.id,
        webhookEventId: savedEvent.id,
        tenantId: storeInfo?.tenantId || 'N/A (unlinked)',
        merchantId: payload.merchant,
        duration: `${Date.now() - startTime}ms`,
      });

      return job.id as string;

    } catch (error) {
      this.logger.error(`❌ Failed to queue webhook: ${payload.eventType}`, {
        error: error instanceof Error ? error.message : 'Unknown',
        merchant: payload.merchant,
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

  async getStoreSecret(merchantId: number): Promise<string | undefined> {
    // البحث عن webhook secret للمتجر
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (store) {
      // TODO: إرجاع webhookSecret من الـ store إذا كان موجوداً
      // return store.webhookSecret;
    }
    
    return undefined;
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

  /**
   * إنشاء سجل log للـ webhook
   * يتخطى الإنشاء إذا لم يكن هناك tenantId
   */
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
    // تخطي إنشاء log إذا لم يكن هناك tenantId
    if (!tenantId) {
      this.logger.debug('Skipping webhook log: tenantId is missing (unlinked webhook)');
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
   * ✅ البحث عن المتجر باستخدام merchantId من سلة
   * يُرجع tenantId و storeId إذا وُجد المتجر
   * ✅ Soft-fail: يرجع null بدون error إذا لم يوجد store
   */
  private async findStoreByMerchantId(merchantId: number): Promise<{
    tenantId: string;
    storeId: string;
  } | null> {
    this.logger.debug(`Looking up store for merchant ${merchantId}`);
    
    try {
      const store = await this.storesService.findByMerchantId(merchantId);
      
      if (store) {
        this.logger.debug(`Found store: ${store.id} for merchant ${merchantId}`);
        return {
          tenantId: store.tenantId,
          storeId: store.id,
        };
      }
      
      // ✅ Soft-fail: لا ترمي error، فقط log warning
      this.logger.warn(
        `⚠️ No store found for merchant ${merchantId}. ` +
        `This is expected if OAuth has not completed yet.`
      );
      return null;
      
    } catch (error) {
      // ✅ Soft-fail: حتى في حالة الخطأ، نرجع null ولا نرمي error
      this.logger.error(`Error looking up store for merchant ${merchantId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
    }
  }

  /**
   * ✅ ربط webhooks غير المربوطة بالمتجر بعد اكتمال OAuth
   * يمكن استدعاؤها بعد connectSallaStore لربط أي webhooks سابقة
   */
  async linkUnlinkedWebhooks(merchantId: number, tenantId: string, storeId: string): Promise<number> {
    try {
      const result = await this.webhookEventRepository
        .createQueryBuilder()
        .update(WebhookEvent)
        .set({ tenantId, storeId })
        .where('tenantId IS NULL')
        .andWhere(`metadata->>'merchantId' = :merchantId`, { merchantId: String(merchantId) })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(`✅ Linked ${result.affected} unlinked webhooks to store ${storeId}`);
      }

      return result.affected || 0;
    } catch (error) {
      this.logger.error(`Failed to link unlinked webhooks for merchant ${merchantId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return 0;
    }
  }

  private extractEntityId(data: Record<string, unknown>): string | undefined {
    const id = data.id;
    return id ? String(id) : undefined;
  }

  private extractEntityType(eventType: string): string | undefined {
    const parts = eventType.split('.');
    return parts[0] || undefined;
  }

  private getEventPriority(eventType: string): number {
    const priorities: Record<string, number> = {
      [SallaEventType.ORDER_CREATED]: 1,
      [SallaEventType.ORDER_PAYMENT_UPDATED]: 1,
      [SallaEventType.CUSTOMER_CREATED]: 2,
      [SallaEventType.ABANDONED_CART]: 2,
      [SallaEventType.ORDER_STATUS_UPDATED]: 4,
      [SallaEventType.SHIPMENT_CREATED]: 4,
      [SallaEventType.TRACKING_REFRESHED]: 5,
      [SallaEventType.PRODUCT_UPDATED]: 7,
      [SallaEventType.REVIEW_ADDED]: 8,
    };

    return priorities[eventType] || 5;
  }

  async getStatistics(tenantId: string, days: number = 7): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byEventType: Record<string, number>;
    averageProcessingTime: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await this.webhookEventRepository
      .createQueryBuilder('event')
      .where('event.tenantId = :tenantId', { tenantId })
      .andWhere('event.createdAt >= :startDate', { startDate })
      .select([
        'event.status',
        'event.eventType',
        'event.processingDurationMs',
      ])
      .getMany();

    const byStatus: Record<string, number> = {};
    const byEventType: Record<string, number> = {};
    let totalProcessingTime = 0;
    let processedCount = 0;

    for (const event of events) {
      byStatus[event.status] = (byStatus[event.status] || 0) + 1;
      byEventType[event.eventType] = (byEventType[event.eventType] || 0) + 1;

      if (event.processingDurationMs) {
        totalProcessingTime += event.processingDurationMs;
        processedCount++;
      }
    }

    return {
      total: events.length,
      byStatus,
      byEventType,
      averageProcessingTime: processedCount > 0
        ? Math.round(totalProcessingTime / processedCount)
        : 0,
    };
  }

  async getFailedWebhooks(tenantId: string, limit: number = 50): Promise<WebhookEvent[]> {
    return this.webhookEventRepository.find({
      where: {
        tenantId,
        status: WebhookStatus.FAILED,
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * ✅ جلب webhooks غير المربوطة (للـ monitoring)
   */
  async getUnlinkedWebhooks(limit: number = 50): Promise<WebhookEvent[]> {
    return this.webhookEventRepository
      .createQueryBuilder('event')
      .where('event.tenantId IS NULL')
      .orderBy('event.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  async retryWebhook(webhookEventId: string): Promise<string> {
    const event = await this.webhookEventRepository.findOne({
      where: { id: webhookEventId },
    });

    if (!event) {
      throw new Error('Webhook event not found');
    }

    const job = await this.webhookQueue.add(
      event.eventType,
      {
        webhookEventId: event.id,
        eventType: event.eventType,
        data: event.payload,
        tenantId: event.tenantId,
        storeId: event.storeId,
        isRetry: true,
      },
      {
        priority: 1,
      },
    );

    await this.createLog(event.id, event.tenantId, {
      action: WebhookLogAction.MANUALLY_RETRIED,
      previousStatus: event.status as WebhookStatus,
      newStatus: WebhookStatus.RETRY_PENDING,
      message: 'Manual retry requested',
    });

    await this.updateStatus(webhookEventId, WebhookStatus.RETRY_PENDING);

    return job.id as string;
  }
}
