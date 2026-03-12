/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFEQ PLATFORM — Salla Integration Module                   ║
 * ║                                                                                ║
 * ║  FIX #6: Platform Isolation — سلة معزولة تماماً عن زد                        ║
 * ║                                                                                ║
 * ║  القاعدة الذهبية:                                                              ║
 * ║    أي إصلاح في هذا الملف لا يلمس زد بأي شكل                                  ║
 * ║    أي إصلاح في ZidModule لا يلمس هذا الملف بأي شكل                           ║
 * ║                                                                                ║
 * ║  يحتوي على:                                                                   ║
 * ║    • SallaStoreService     — ربط + مزامنة متاجر سلة                           ║
 * ║    • SallaApiService       — التواصل مع Salla API                              ║
 * ║    • SallaOAuthService     — OAuth 2.0 لسلة                                  ║
 * ║    • SallaWebhooksService  — استقبال + queue webhooks سلة                     ║
 * ║    • SallaWebhookProcessor — معالجة أحداث سلة                                 ║
 * ║    • SallaOrderHandler     — FIX #8: منطق الطلبات منفصل                       ║
 * ║    • SallaCustomerHandler  — FIX #8: منطق العملاء منفصل                       ║
 * ║    • SallaStatusMapper     — FIX #8: ترجمة حالات سلة                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { Store } from '@modules/stores/entities/store.entity';
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { WebhookLog } from '@modules/webhooks/entities/webhook-log.entity';
import { Order, Customer } from '@database/entities';

// Salla-specific services (لا يوجد أي import من Zid)
import { SallaStoreService } from '@modules/stores/salla-store.service';
import { SallaApiService } from '@modules/stores/salla-api.service';
import { SallaOAuthService } from '@modules/stores/salla-oauth.service';
import { SallaOAuthController } from '@modules/stores/salla-oauth.controller';

// Salla Webhooks (معزولة)
import { SallaWebhooksService } from '@modules/webhooks/salla-webhooks.service';
import { SallaWebhooksController } from '@modules/webhooks/salla-webhooks.controller';

// Salla Processor (يستخدم handlers من FIX #8)
import { SallaWebhookProcessor } from '@modules/webhooks/processors/salla-webhook.processor';

// FIX #8: Handlers منفصلة (actual paths)
import { SallaStatusMapper } from '@modules/webhooks/processors/salla/salla-status.mapper';
import { SallaOrderHandler } from '@modules/webhooks/processors/salla/salla-order.handler';
import { SallaMiscHandler } from '@modules/webhooks/processors/salla/salla-misc.handler';

// Shared dependencies
import { TenantsModule } from '@modules/tenants/tenants.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Store,
      WebhookEvent,
      WebhookLog,
      Order,
      Customer,
    ]),

    BullModule.registerQueue({
      name: 'salla-webhooks',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail:     { count: 5000 },
      },
    }),

    ConfigModule,
    TenantsModule,
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
  ],

  controllers: [
    SallaOAuthController,
    SallaWebhooksController,
  ],

  providers: [
    // Salla Platform Services
    SallaStoreService,
    SallaApiService,
    SallaOAuthService,

    // Salla Webhooks
    SallaWebhooksService,
    SallaWebhookProcessor,

    // FIX #8: Handlers منفصلة بدل God Class
    SallaStatusMapper,
    SallaOrderHandler,
    SallaMiscHandler,
  ],

  exports: [
    // نُصدّر فقط ما يحتاجه StoresModule (Facade)
    SallaStoreService,
    SallaApiService,
    SallaOAuthService,
    SallaWebhooksService,
    SallaStatusMapper,
    SallaOrderHandler,
    SallaMiscHandler,
  ],
})
export class SallaIntegrationModule {}
