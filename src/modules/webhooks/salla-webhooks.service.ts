/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhooks Service                         ║
 * ║                                                                                ║
 * ║  ✅ Production-ready: ربط merchantId → Store → tenantId                       ║
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

  async queueWebhook(payload: SallaWebhookJobDto): Promise<string> {
    const startTime = Date.now();

    try {
      // ✅ البحث عن المتجر باستخدام merchantId
      const storeInfo = await this.findStoreByMerchantId(payload.merchant);

      if (!storeInfo) {
        // ─── FIX #1: تمييز Communication webhooks — تحتاج tenantId بالضرورة
        const isCommunicationEvent = payload.eventType.startsWith('communication.');
        if (isCommunicationEvent) {
          this.logger.error(
            `🚨 CRITICAL: Communication webhook "${payload.eventType}" arrived for merchant ${payload.merchant} ` +
            `but NO store found in DB! This notification CANNOT be sent. ` +
            `Ensure app.store.authorize was processed and store is linked to a tenant. ` +
            `Check: SELECT * FROM stores WHERE salla_merchant_id = ${payload.merchant};`
          );
        } else {
          this.logger.warn(`No store found for merchant ${payload.merchant} - webhook will be saved without tenantId`);
        }
      } else {
        this.logger.log(`✅ Found store for merchant ${payload.merchant}: tenantId=${storeInfo.tenantId}, storeId=${storeInfo.storeId}`);
      }

      const webhookEvent = this.webhookEventRepository.create({
        tenantId: storeInfo?.tenantId,
        storeId: storeInfo?.storeId,
        source: WebhookSource.SALLA,
        eventType: payload.eventType,
        externalId: payload.deliveryId,
        idempotencyKey: payload.idempotencyKey,
        // ✅ حفظ merchantId في الـ payload للاسترجاع المستقبلي
        payload: { ...payload.data, _merchant: payload.merchant },
        headers: payload.headers,
        status: WebhookStatus.PENDING,
        ipAddress: payload.ipAddress,
        signature: payload.signature,
        signatureVerified: payload.signatureVerified ?? false, // ✅ FIX #2: قيمة حقيقية من Controller
        relatedEntityId: this.extractEntityId(payload.data),
        relatedEntityType: this.extractEntityType(payload.eventType),
      });

      const savedEvent = await this.webhookEventRepository.save(webhookEvent);

      // إنشاء log (سيتم تخطيه إذا لم يكن هناك tenantId)
      await this.createLog(savedEvent.id, savedEvent.tenantId, {
        action: WebhookLogAction.RECEIVED,
        newStatus: WebhookStatus.PENDING,
        message: `Webhook received: ${payload.eventType}`,
        durationMs: Date.now() - startTime,
      });

      const job = await this.webhookQueue.add(
        payload.eventType,
        {
          webhookEventId: savedEvent.id,
          eventType: payload.eventType,
          merchant: payload.merchant,
          data: payload.data,
          tenantId: storeInfo?.tenantId,
          storeId: storeInfo?.storeId,
        },
        {
          // ✅ FIX CRITICAL: لا نستخدم idempotencyKey كـ jobId في BullMQ
          // السبب: BullMQ يتجاهل add() بصمت إذا jobId موجود (حتى لو failed)
          // النتيجة: webhook لأول فشل → blocked للأبد → لا لوق → لا إشعار
          // الحل: checkDuplicate في DB يتولى منع التكرار (موثوق أكثر)
          // jobId: payload.idempotencyKey, ← محذوف
          priority: this.getEventPriority(payload.eventType),
          removeOnComplete: true,
          removeOnFail: true,   // ✅ حذف الـ failed jobs حتى لا تحجب القادمة
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      this.eventEmitter.emit('webhook.received', {
        source: 'salla',
        eventType: payload.eventType,
        webhookEventId: savedEvent.id,
        tenantId: storeInfo?.tenantId,
      });

      this.logger.log(`✅ Webhook queued: ${payload.eventType}`, {
        jobId: job.id,
        webhookEventId: savedEvent.id,
        tenantId: storeInfo?.tenantId || 'N/A',
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

  /**
   * ✅ منع تكرار معالجة نفس الـ webhook
   * يمنع فقط: PROCESSED و PROCESSING
   * يسمح بإعادة المحاولة: FAILED / PENDING / SKIPPED
   */
  async checkDuplicate(idempotencyKey: string): Promise<boolean> {
    const existing = await this.webhookEventRepository.findOne({
      where: [
        { idempotencyKey, status: WebhookStatus.PROCESSED },
        { idempotencyKey, status: WebhookStatus.PROCESSING },
      ],
      select: ['id', 'status', 'eventType'],
    });

    if (existing) {
      this.logger.warn(
        `🔁 Duplicate webhook BLOCKED — already ${existing.status}`,
        {
          idempotencyKey: idempotencyKey.substring(0, 16) + '...',
          existingId: existing.id,
          eventType: (existing as any).eventType,
        },
      );
      return true;
    }

    return false;
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
   * ✅ البحث عن المتجر باستخدام merchantId من سلة
   * يُرجع tenantId و storeId إذا وُجد المتجر
   */
  private async findStoreByMerchantId(merchantId: number): Promise<{
    tenantId: string;
    storeId: string;
  } | null> {
    this.logger.log(`🔍 Looking up store for merchant ${merchantId}`);
    
    try {
      const store = await this.storesService.findByMerchantId(merchantId);
      
      if (store) {
        // ✅ FIX: tenantId قد يكون null/undefined (store exists but not linked to tenant yet)
        if (!store.tenantId) {
          this.logger.warn(`⚠️ Store ${store.id} found for merchant ${merchantId} but tenantId is NULL — store not linked to tenant yet`);
          return null;
        }

        this.logger.log(`✅ Found store: ${store.id} for merchant ${merchantId} (tenant: ${store.tenantId})`);
        return {
          tenantId: store.tenantId,
          storeId: store.id,
        };
      }
      
      this.logger.warn(`⚠️ No store found for merchant ${merchantId} — check if sallaMerchantId is correctly stored in DB`);
      return null;
      
    } catch (error) {
      this.logger.error(`❌ Error looking up store for merchant ${merchantId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return null;
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
      // ─── Priority 1: إرسال فوري للعميل ───
      [SallaEventType.ORDER_CREATED]: 1,
      [SallaEventType.ORDER_PAYMENT_UPDATED]: 1,
      // ✅ Communication webhooks: الأولوية الأعلى — سلة طلبت الإرسال للعميل الآن
      [SallaEventType.COMMUNICATION_WHATSAPP_SEND]: 1,
      [SallaEventType.COMMUNICATION_SMS_SEND]: 1,
      [SallaEventType.COMMUNICATION_EMAIL_SEND]: 1,

      // ─── Priority 2 ───
      [SallaEventType.CUSTOMER_CREATED]: 2,
      [SallaEventType.ABANDONED_CART]: 2,

      // ─── Priority 4 ───
      [SallaEventType.ORDER_STATUS_UPDATED]: 4,
      [SallaEventType.SHIPMENT_CREATED]: 4,

      // ─── Priority 5 (default) ───
      [SallaEventType.TRACKING_REFRESHED]: 5,

      // ─── Priority 7-8 (low) ───
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

  async retryWebhook(webhookEventId: string, _tenantId?: string): Promise<string> {
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
