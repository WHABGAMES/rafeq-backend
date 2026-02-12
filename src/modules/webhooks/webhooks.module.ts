/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhooks Module                            ║
 * ║  ✅ v3: إضافة Order + Customer repos لجلب رقم العميل                          ║
 * ║  ✅ v4: إضافة دعم زد (Zid) — Controller + Service + Processor + Queue         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

// Controllers
import { WebhooksController } from './webhooks.controller';
import { SallaWebhooksController } from './salla-webhooks.controller';
import { ZidWebhooksController } from './zid-webhooks.controller';            // ✅ v4: زد

// Services
import { WebhooksService } from './webhooks.service';
import { SallaWebhooksService } from './salla-webhooks.service';
import { ZidWebhooksService } from './zid-webhooks.service';                  // ✅ v4: زد
import { WebhookVerificationService } from './webhook-verification.service';
import { TemplateDispatcherService } from './template-dispatcher.service';
import { TemplateSchedulerService } from './template-scheduler.service';

// Processors
import { SallaWebhookProcessor } from './processors/salla-webhook.processor';
import { ZidWebhookProcessor } from './processors/zid-webhook.processor';     // ✅ v4: زد
import { TemplateSchedulerProcessor } from './processors/template-scheduler.processor';

// Entities
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { Order, Customer, ScheduledTemplateSend } from '@database/entities';

// Related Modules
import { StoresModule } from '../stores/stores.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ChannelsModule } from '../channels/channels.module';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WebhookEvent,
      WebhookLog,
      Order,                   // ✅ v3: للبحث عن الطلب بـ sallaOrderId / zidOrderId
      Customer,                // ✅ v3: لجلب رقم هاتف العميل
      ScheduledTemplateSend,   // ✅ v13: تتبع الإرسال المجدول
    ]),

    BullModule.registerQueue({
      name: 'salla-webhooks',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    }),

    // ✅ v4: Queue لمعالجة webhooks زد
    BullModule.registerQueue({
      name: 'zid-webhooks',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    }),

    // ✅ v13: Queue للإرسال المؤجل
    BullModule.registerQueue({
      name: 'template-scheduler',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 2000, age: 48 * 3600 },
        removeOnFail: { count: 5000 },
      },
    }),

    ConfigModule,
    StoresModule,
    MessagingModule,
    ChannelsModule,   // ✅ يوفر ChannelsService + Channel Repository
    TemplatesModule,  // ✅ يوفر TemplatesService + MessageTemplate Repository
  ],

  controllers: [
    WebhooksController,
    SallaWebhooksController,
    ZidWebhooksController,      // ✅ v4: POST /webhooks/zid/:eventType
  ],

  providers: [
    WebhooksService,
    SallaWebhooksService,
    ZidWebhooksService,           // ✅ v4: زد
    WebhookVerificationService,
    TemplateDispatcherService,      // ✅ إرسال رسائل واتساب تلقائية
    TemplateSchedulerService,       // ✅ v13: جدولة الإرسال المؤجل
    TemplateSchedulerProcessor,     // ✅ v13: معالج الإرسال المؤجل
    SallaWebhookProcessor,
    ZidWebhookProcessor,            // ✅ v4: معالج webhooks زد
  ],

  exports: [
    WebhooksService,
    SallaWebhooksService,
    ZidWebhooksService,             // ✅ v4: تصدير خدمة زد
    TemplateSchedulerService,
  ],
})
export class WebhooksModule {}
