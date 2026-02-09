/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Notification Event Listener                          ║
 * ║                                                                                ║
 * ║  🔗 الجسر بين نظام Webhooks الحالي ونظام التنبيهات                            ║
 * ║  يستمع لأحداث EventEmitter2 من SallaWebhooksService                           ║
 * ║  ويُفعّل التنبيهات التلقائية للموظفين                                        ║
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

  constructor(
    private readonly notificationsService: EmployeeNotificationsService,
  ) {}

  /**
   * ✅ الاستماع لحدث webhook.processed
   * 
   * هذا الحدث يُطلق بعد معالجة الـ webhook بنجاح
   * (يجب إضافته في الـ webhook processor بعد المعالجة الناجحة)
   * 
   * مسار التدفق:
   * Salla → Webhook Controller → SallaWebhooksService.queueWebhook() 
   *   → emit('webhook.received') → Queue → Processor 
   *   → emit('webhook.processed') → ⭐ هنا يتم تفعيل التنبيهات
   */
  @OnEvent('webhook.processed')
  async handleWebhookProcessed(event: WebhookProcessedEvent): Promise<void> {
    if (!event.tenantId) {
      this.logger.debug('Skipping notification: no tenantId');
      return;
    }

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
   * 
   * مثال: تنبيه فوري عند وصول طلب جديد
   */
  @OnEvent('webhook.received')
  async handleWebhookReceived(event: WebhookReceivedEvent): Promise<void> {
    // اختياري: يمكن استخدامه للتنبيهات الفورية
    // حالياً مُعطّل لتجنب التنبيهات المزدوجة
    this.logger.debug(
      `📥 Webhook received: ${event.eventType} (notification deferred to processing)`,
    );
  }
}
