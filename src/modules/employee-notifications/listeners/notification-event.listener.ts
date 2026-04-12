/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Notification Event Listener                          ║
 * ║                                                                                ║
 * ║  🔗 الجسر بين نظام Webhooks الحالي ونظام التنبيهات                            ║
 * ║  يستمع لأحداث EventEmitter2 من SallaWebhooksService                           ║
 * ║  ويُفعّل التنبيهات التلقائية للموظفين                                        ║
 * ║                                                                                ║
 * ║  ✅ v2: Dedup — يمنع تكرار الإشعار عند وصول نفس الحدث من مسارين              ║
 * ║  سلة ترسل order.created + communication.whatsapp.send معاً                    ║
 * ║  كلاهما يُطلق webhook.processed → بدون dedup = إشعار مكرر                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmployeeNotificationsService } from '../employee-notifications.service';

// ═══════════════════════════════════════════════════════════
// Types: أحداث من SallaWebhooksService
// ═══════════════════════════════════════════════════════════

interface WebhookReceivedEvent {
  source: string;
  eventType: string;
  webhookEventId: string;
  tenantId?: string;
}

interface WebhookProcessedEvent {
  webhookEventId: string;
  eventType: string;
  tenantId?: string;
  storeId?: string;
  data: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════
// Listener
// ═══════════════════════════════════════════════════════════

@Injectable()
export class NotificationEventListener {
  private readonly logger = new Logger(NotificationEventListener.name);

  /**
   * ✅ v2: Dedup cache لمنع إشعارات الموظفين المكررة
   * 
   * السبب: سلة ترسل نفس الحدث عبر مسارين:
   *   1. order.created → webhook.processed (eventType: order.created)
   *   2. communication.whatsapp.send → maps order.notification.create → order.created
   *      → webhook.processed (eventType: order.created) مرة ثانية
   * 
   * الحل: نسجل كل حدث بمفتاح (tenantId:eventType:entityId)
   * ونتجاهل التكرار خلال 60 ثانية
   */
  private readonly recentEvents = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 60_000; // 60 ثانية

  constructor(
    private readonly notificationsService: EmployeeNotificationsService,
  ) {}

  /**
   * ✅ الاستماع لحدث webhook.processed
   */
  @OnEvent('webhook.processed')
  async handleWebhookProcessed(event: WebhookProcessedEvent): Promise<void> {
    if (!event.tenantId) {
      this.logger.debug('Skipping notification: no tenantId');
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // ✅ v2: Dedup — منع التكرار
    // ═══════════════════════════════════════════════════════════
    const entity = (event.data?.entity || {}) as Record<string, unknown>;
    const entityId = String(
      entity.id || event.data?.id || event.data?.orderId || event.webhookEventId || '',
    );
    const dedupKey = `${event.tenantId}:${event.eventType}:${entityId}`;
    const now = Date.now();

    // تنظيف المدخلات القديمة (أكثر من 60 ثانية)
    if (this.recentEvents.size > 500) {
      for (const [key, ts] of this.recentEvents) {
        if (now - ts > this.DEDUP_WINDOW_MS) this.recentEvents.delete(key);
      }
    }

    // فحص التكرار
    const lastSeen = this.recentEvents.get(dedupKey);
    if (lastSeen && now - lastSeen < this.DEDUP_WINDOW_MS) {
      this.logger.debug(
        `🔁 Dedup: skipping duplicate employee notification [${event.eventType}] entity=${entityId}`,
      );
      return;
    }

    // تسجيل الحدث
    this.recentEvents.set(dedupKey, now);

    // ═══════════════════════════════════════════════════════════
    // معالجة الإشعار
    // ═══════════════════════════════════════════════════════════
    try {
      this.logger.debug(
        `🔔 Processing notifications for event: ${event.eventType}`,
        { tenantId: event.tenantId },
      );

      const count = await this.notificationsService.processEvent({
        tenantId: event.tenantId,
        storeId: event.storeId,
        eventType: event.eventType,
        data: event.data,
        webhookEventId: event.webhookEventId,
      });

      if (count > 0) {
        this.logger.log(
          `✅ ${count} notifications created for ${event.eventType}`,
          { tenantId: event.tenantId },
        );
      }
    } catch (error) {
      // لا نُسقط العملية الأصلية إذا فشل التنبيه
      this.logger.error(
        `❌ Failed to process notifications for ${event.eventType}`,
        {
          error: error instanceof Error ? error.message : 'Unknown',
          tenantId: event.tenantId,
          webhookEventId: event.webhookEventId,
        },
      );
    }
  }

  /**
   * يمكن أيضاً الاستماع لحدث webhook.received
   * للتنبيهات الفورية (قبل المعالجة)
   */
  @OnEvent('webhook.received')
  async handleWebhookReceived(event: WebhookReceivedEvent): Promise<void> {
    this.logger.debug(
      `📥 Webhook received: ${event.eventType} (notification deferred to processing)`,
    );
  }
}
