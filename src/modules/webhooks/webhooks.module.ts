/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhooks Module                            ║
 * ║  ✅ v5: إصلاح ترتيب Controllers — المسارات المحددة أولاً                       ║
 * ║  ✅ v4: إضافة زد webhooks (controller + service + processor + queue)          ║
 * ║  ✅ v3: إضافة Order + Customer repos لجلب رقم العميل                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

// Controllers
import { WebhooksController } from './webhooks.controller';
import { SallaWebhooksController } from './salla-webhooks.controller';
import { ZidWebhooksController } from './zid-webhooks.controller';

// Services
import { WebhooksService } from './webhooks.service';
import { SallaWebhooksService } from './salla-webhooks.service';
import { ZidWebhooksService } from './zid-webhooks.service';
import { WebhookVerificationService } from './webhook-verification.service';
import { TemplateDispatcherService } from './template-dispatcher.service';
import { TemplateSchedulerService } from './template-scheduler.service';

// Processors
import { SallaWebhookProcessor } from './processors/salla-webhook.processor';
import { ZidWebhookProcessor } from './processors/zid-webhook.processor';
import { TemplateSchedulerProcessor } from './processors/template-scheduler.processor';

// Entities
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { Order, Customer, ScheduledTemplateSend } from '@database/entities';
import { Store } from '../stores/entities/store.entity';

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
      Order,
      Customer,
      ScheduledTemplateSend,
      Store,
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

    BullModule.registerQueue({
      name: 'zid-webhooks',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    }),

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
    ChannelsModule,
    TemplatesModule,
  ],

  /**
   * ⚠️ ترتيب الـ Controllers مهم جداً في NestJS!
   *
   * المسارات المحددة (webhooks/salla, webhooks/zid) يجب أن تُسجّل قبل
   * المسار المعمّم (webhooks/:id) وإلا WebhooksController يلتقط الطلبات
   * الموجهة لسلة وزد بسبب @Get(':id') → JwtAuthGuard → 401
   *
   * الترتيب الصحيح:
   *   1. SallaWebhooksController → @Controller('webhooks/salla')  [مسار ثابت]
   *   2. ZidWebhooksController   → @Controller('webhooks/zid')    [مسار ثابت]
   *   3. WebhooksController      → @Controller('webhooks')        [مسار معمّم :id]
   */
  controllers: [
    SallaWebhooksController,   // ← webhooks/salla (ثابت - أولاً)
    ZidWebhooksController,     // ← webhooks/zid   (ثابت - ثانياً)
    WebhooksController,        // ← webhooks/:id   (معمّم - أخيراً)
  ],

  providers: [
    WebhooksService,
    SallaWebhooksService,
    ZidWebhooksService,
    WebhookVerificationService,
    TemplateDispatcherService,
    TemplateSchedulerService,
    TemplateSchedulerProcessor,
    SallaWebhookProcessor,
    ZidWebhookProcessor,
  ],

  exports: [
    WebhooksService,
    SallaWebhooksService,
    ZidWebhooksService,
    TemplateSchedulerService,
  ],
})
export class WebhooksModule {}
