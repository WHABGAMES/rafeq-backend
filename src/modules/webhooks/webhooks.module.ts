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

// ✅ Entities - Import from database (single source of truth)
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { WebhookLog } from './entities/webhook-log.entity';

// Related Modules
import { StoresModule } from '../stores/stores.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════════════════
    // 📁 Database Entities
    // ═══════════════════════════════════════════════════════════════════════════════
    TypeOrmModule.forFeature([
      WebhookEvent,  // ✅ من @database/entities
      WebhookLog,    // من ./entities (محلي - لا يوجد تكرار)
    ]),

    // ═══════════════════════════════════════════════════════════════════════════════
    // 📬 Queue للمعالجة غير المتزامنة
    // ═══════════════════════════════════════════════════════════════════════════════
    BullModule.registerQueue({
      name: 'salla-webhooks',
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          count: 1000,
          age: 24 * 3600,
        },
        removeOnFail: {
          count: 5000,
        },
      },
    }),

    // ═══════════════════════════════════════════════════════════════════════════════
    // 📦 Related Modules
    // ═══════════════════════════════════════════════════════════════════════════════
    ConfigModule,
    StoresModule,
    MessagingModule,
  ],

  controllers: [
    WebhooksController,
    SallaWebhooksController,
  ],

  providers: [
    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔧 Services
    // ═══════════════════════════════════════════════════════════════════════════════
    WebhooksService,
    SallaWebhooksService,
    WebhookVerificationService,

    // ═══════════════════════════════════════════════════════════════════════════════
    // ⚙️ Queue Processors
    // ═══════════════════════════════════════════════════════════════════════════════
    SallaWebhookProcessor,
  ],

  exports: [
    WebhooksService,
    SallaWebhooksService,
  ],
})
export class WebhooksModule {}
