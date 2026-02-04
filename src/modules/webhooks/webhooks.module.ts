/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhooks Module                            ║
 * ║  ✅ v2: إضافة TemplateDispatcherService + ChannelsModule + TemplatesModule    ║
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
import { TemplateDispatcherService } from './template-dispatcher.service';

// Processors
import { SallaWebhookProcessor } from './processors/salla-webhook.processor';

// Entities
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { WebhookLog } from './entities/webhook-log.entity';

// Related Modules
import { StoresModule } from '../stores/stores.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ChannelsModule } from '../channels/channels.module';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, WebhookLog]),

    BullModule.registerQueue({
      name: 'salla-webhooks',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000 },
      },
    }),

    ConfigModule,
    StoresModule,
    MessagingModule,
    ChannelsModule,   // ✅ يوفر ChannelsService + Channel Repository
    TemplatesModule,  // ✅ يوفر TemplatesService + MessageTemplate Repository
  ],

  controllers: [WebhooksController, SallaWebhooksController],

  providers: [
    WebhooksService,
    SallaWebhooksService,
    WebhookVerificationService,
    TemplateDispatcherService, // ✅ إرسال رسائل واتساب تلقائية
    SallaWebhookProcessor,
  ],

  exports: [WebhooksService, SallaWebhooksService],
})
export class WebhooksModule {}
