/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhooks Module                            ║
 * ║                                                                                ║
 * ║  Module لاستقبال ومعالجة الـ Webhooks من سلة وأي مصادر خارجية                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

// Controllers
import { WebhooksController } from './webhooks.controller';
import { SallaWebhooksController } from './salla-webhooks.controller';

// Services
import { WebhooksService } from './webhooks.service';
import { SallaWebhooksService } from './salla-webhooks.service';
import { WebhookVerificationService } from './webhook-verification.service';

// Processors (BullMQ)
import { SallaWebhookProcessor } from './processors/salla-webhook.processor';

// Entities
import { WebhookEvent } from './entities/webhook-event.entity';
import { WebhookLog } from './entities/webhook-log.entity';

// Related Modules
import { StoresModule } from '../stores/stores.module';
import { MessagingModule } from '../messaging/messaging.module';

/**
 * 📌 ماهو Webhook؟
 * 
 * Webhook = رسالة HTTP يرسلها نظام خارجي (مثل سلة) لإعلامك بحدث
 * 
 * مثال:
 * 1. عميل يشتري من متجرك في سلة
 * 2. سلة تُرسل POST request لـ API نظامك
 * 3. نظامك يستقبل الحدث ويعالجه (مثلاً: يرسل رسالة شكر للعميل)
 * 
 * لماذا Webhooks بدلاً من Polling؟
 * - Polling: تسأل سلة كل 5 دقائق "هل في طلبات جديدة؟" → مكلف وبطيء
 * - Webhooks: سلة تُخبرك فوراً عند حدوث أي شيء → سريع وفعال
 * 
 * تحديات الـ Webhooks:
 * 1. التحقق من الهوية (هل هذا فعلاً من سلة؟)
 * 2. التعامل مع الفشل (إعادة المحاولة)
 * 3. منع التكرار (idempotency)
 * 4. الأداء (معالجة آلاف الأحداث/ثانية)
 */

@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════════════════
    // 📁 Database Entities
    // ═══════════════════════════════════════════════════════════════════════════════
    TypeOrmModule.forFeature([
      WebhookEvent,  // جدول الأحداث
      WebhookLog,    // جدول سجل الـ webhooks
    ]),

    // ═══════════════════════════════════════════════════════════════════════════════
    // 📬 Queue للمعالجة غير المتزامنة
    // ═══════════════════════════════════════════════════════════════════════════════
    /**
     * لماذا Queue؟
     * 
     * عند استقبال webhook:
     * 1. نحفظه في الـ queue فوراً (< 100ms)
     * 2. نرد على سلة بـ 200 OK
     * 3. الـ processor يعالج الحدث في الخلفية
     * 
     * فوائد:
     * - سلة لن تنتظر (لا timeout)
     * - يمكن إعادة المحاولة إذا فشلت المعالجة
     * - يمكن معالجة آلاف الأحداث بالتوازي
     */
    BullModule.registerQueue({
      name: 'salla-webhooks', // اسم الـ Queue
      defaultJobOptions: {
        attempts: 5,           // 5 محاولات
        backoff: {
          type: 'exponential', // زيادة تدريجية بين المحاولات
          delay: 2000,         // تبدأ بثانيتين
        },
        removeOnComplete: {
          count: 1000,         // يحتفظ بآخر 1000 job مكتملة
          age: 24 * 3600,      // أو jobs أقدم من 24 ساعة
        },
        removeOnFail: {
          count: 5000,         // يحتفظ بآخر 5000 job فاشلة
        },
      },
    }),

    // ═══════════════════════════════════════════════════════════════════════════════
    // 📦 Related Modules
    // ═══════════════════════════════════════════════════════════════════════════════
    ConfigModule,
    StoresModule,     // للوصول لبيانات المتجر
    MessagingModule,  // لإرسال الرسائل
  ],

  controllers: [
    WebhooksController,       // Controller عام
    SallaWebhooksController,  // Controller خاص بسلة
  ],

  providers: [
    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔧 Services
    // ═══════════════════════════════════════════════════════════════════════════════
    WebhooksService,           // خدمة عامة للـ webhooks
    SallaWebhooksService,      // خدمة خاصة بسلة
    WebhookVerificationService, // التحقق من صحة الـ webhooks

    // ═══════════════════════════════════════════════════════════════════════════════
    // ⚙️ Queue Processors
    // ═══════════════════════════════════════════════════════════════════════════════
    SallaWebhookProcessor,     // معالج أحداث سلة
  ],

  exports: [
    WebhooksService,
    SallaWebhooksService,
  ],
})
export class WebhooksModule {}

/**
 * 📌 Flow كامل لاستقبال Webhook من سلة:
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                              WEBHOOK FLOW                                   │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                             │
 * │  ┌─────────┐      POST /webhooks/salla      ┌──────────────────┐           │
 * │  │  سلة    │ ─────────────────────────────> │ SallaWebhooks    │           │
 * │  │         │                                │ Controller       │           │
 * │  └─────────┘                                └────────┬─────────┘           │
 * │                                                      │                     │
 * │                                                      ▼                     │
 * │                                          ┌──────────────────────┐          │
 * │                                          │ WebhookVerification  │          │
 * │                                          │ Service              │          │
 * │                                          │ (التحقق من التوقيع)    │          │
 * │                                          └──────────┬───────────┘          │
 * │                                                     │                      │
 * │                                     ┌───────────────┼───────────────┐      │
 * │                                     │               │               │      │
 * │                                     ▼               ▼               ▼      │
 * │                               صحيح ✓         خطأ ✗          مكرر 🔄        │
 * │                                     │               │               │      │
 * │                                     │               │               │      │
 * │                                     ▼               ▼               ▼      │
 * │                        ┌────────────────┐    Return 401      Return 200   │
 * │                        │ Save to Queue  │    (Unauthorized)  (Already     │
 * │                        │ (BullMQ)       │                    processed)   │
 * │                        └───────┬────────┘                                 │
 * │                                │                                          │
 * │                                ▼                                          │
 * │                    ┌────────────────────┐                                 │
 * │                    │ Return 200 OK      │  ◄── سلة تنتظر هذا              │
 * │                    │ (< 100ms)          │                                 │
 * │                    └────────────────────┘                                 │
 * │                                                                           │
 * │  ════════════════════════ Background Processing ════════════════════════  │
 * │                                                                           │
 * │                        ┌────────────────────┐                             │
 * │                        │ SallaWebhook       │                             │
 * │                        │ Processor          │                             │
 * │                        │ (BullMQ Worker)    │                             │
 * │                        └────────┬───────────┘                             │
 * │                                 │                                         │
 * │            ┌────────────────────┼────────────────────┐                   │
 * │            │                    │                    │                   │
 * │            ▼                    ▼                    ▼                   │
 * │     order.created       customer.created      shipment.updated          │
 * │            │                    │                    │                   │
 * │            ▼                    ▼                    ▼                   │
 * │     Save Order &         Save Customer        Update Order &            │
 * │     Send Welcome         Send Welcome         Notify Customer           │
 * │     Message              Message                                         │
 * │                                                                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
