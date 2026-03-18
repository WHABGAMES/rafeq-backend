/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Conversion Elements Module                           ║
 * ║                                                                                ║
 * ║  Complete CRO (Conversion Rate Optimization) engine.                          ║
 * ║                                                                                ║
 * ║  Components:                                                                   ║
 * ║  ├── Entities (4):                                                            ║
 * ║  │   ├── ConversionElement  — element definition + settings                   ║
 * ║  │   ├── ElementEvent       — raw tracking events (high-volume)               ║
 * ║  │   ├── ElementAnalyticsDaily — pre-aggregated daily stats                   ║
 * ║  │   └── ABTest             — A/B test configuration                          ║
 * ║  ├── Services (3):                                                            ║
 * ║  │   ├── ConversionElementsService  — CRUD + business logic                   ║
 * ║  │   ├── ElementTrackingService     — high-perf event ingestion               ║
 * ║  │   └── ElementAnalyticsService    — dashboard queries + CRON rollup         ║
 * ║  ├── Controllers (4):                                                         ║
 * ║  │   ├── ElementsPublicController   — embed.js, public config, tracking       ║
 * ║  │   ├── ElementsManageController   — CRUD (JWT auth)                         ║
 * ║  │   ├── ElementsAnalyticsController — dashboard analytics (JWT auth)         ║
 * ║  │   └── ElementsABTestController   — A/B test management (JWT auth)          ║
 * ║  └── Processors (1):                                                          ║
 * ║      └── ElementEventsProcessor     — BullMQ queue worker                     ║
 * ║                                                                                ║
 * ║  Queue: element-events (BullMQ/Redis)                                         ║
 * ║  CRON: Hourly daily rollup + 6-hourly A/B test evaluation                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { ConversionElement } from './entities/conversion-element.entity';
import { ElementEvent } from './entities/element-event.entity';
import { ElementAnalyticsDaily } from './entities/element-analytics-daily.entity';
import { ABTest } from './entities/ab-test.entity';
import { Store } from '../stores/entities/store.entity';

// Services
import { ConversionElementsService } from './services/conversion-elements.service';
import { ElementTrackingService, ELEMENT_EVENTS_QUEUE } from './services/element-tracking.service';
import { ElementAnalyticsService } from './services/element-analytics.service';

// Controllers
import {
  ElementsPublicController,
  ElementsManageController,
  ElementsAnalyticsController,
  ElementsABTestController,
} from './controllers';

// Processors
import { ElementEventsProcessor } from './processors/element-events.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversionElement,
      ElementEvent,
      ElementAnalyticsDaily,
      ABTest,
      Store,
    ]),

    // Queue registration
    BullModule.registerQueue({
      name: ELEMENT_EVENTS_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],

  controllers: [
    ElementsPublicController,
    ElementsManageController,
    ElementsAnalyticsController,
    ElementsABTestController,
  ],

  providers: [
    ConversionElementsService,
    ElementTrackingService,
    ElementAnalyticsService,
    ElementEventsProcessor,
  ],

  exports: [
    ConversionElementsService,
    ElementTrackingService,
    ElementAnalyticsService,
  ],
})
export class ConversionElementsModule {}
