/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhooks Module                            ║
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
      Order,
      Customer,
      ScheduledTemplateSend,
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

    // ✅ v4: Queue زد
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

  controllers: [
    WebhooksController,
    SallaWebhooksController,
    ZidWebhooksController,
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
