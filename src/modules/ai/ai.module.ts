/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Module (v6 — Self-Learning)                   ║
 * ║                                                                                ║
 * ║  ✅ v6: إضافة نظام التعلم الذاتي                                             ║
 * ║  - UnansweredQuestion entity                                                   ║
 * ║  - AILearningService (listener + API)                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// ✅ Entities
import { Message, Conversation, Order } from '@database/entities';
import { StoreSettings } from '../settings/entities/store-settings.entity';
import { Store } from '../stores/entities/store.entity';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { UnansweredQuestion } from './entities/unanswered-question.entity';

// Service, Controller & Listeners
import { AIService } from './ai.service';
import { AILearningService } from './ai-learning.service';
import { AiController } from './ai.controller';
import { AIMessageListener } from './ai-message.listener';
import { AIHandoffListener } from './ai-handoff.listener';

import { MessagingModule } from '../messaging/messaging.module';
import { ChannelsModule } from '../channels/channels.module';
import { GatewayModule } from '../gateway/gateway.module';
import { MailModule } from '../mail/mail.module';

// ✅ Platform-Agnostic Product Search
import { ProductSearchFactory } from '../../core/ports/product-search.factory';
import { SallaProductSearchAdapter } from '../../integrations/salla/salla-product-search.adapter';
import { ZidProductSearchAdapter } from '../../integrations/zid/zid-product-search.adapter';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeBase,
      UnansweredQuestion,  // ✅ v6: جدول الأسئلة بدون إجابة
      StoreSettings,
      Conversation,
      Message,
      Order,
      Store,
    ]),

    forwardRef(() => MessagingModule),
    ChannelsModule,
    GatewayModule,
    MailModule,
    StoresModule,
    ConfigModule,
  ],

  controllers: [AiController],

  providers: [
    AIService,
    AILearningService,  // ✅ v6: نظام التعلم الذاتي
    AIMessageListener,
    AIHandoffListener,

    // ─── Product Search Adapters ───────────────────────────────────────────
    SallaProductSearchAdapter,
    ZidProductSearchAdapter,

    {
      provide: ProductSearchFactory,
      useFactory: (
        storeRepo: Repository<Store>,
        sallaAdapter: SallaProductSearchAdapter,
        zidAdapter: ZidProductSearchAdapter,
      ) => new ProductSearchFactory(storeRepo, [sallaAdapter, zidAdapter]),
      inject: [
        getRepositoryToken(Store),
        SallaProductSearchAdapter,
        ZidProductSearchAdapter,
      ],
    },
  ],

  exports: [AIService, AILearningService, ProductSearchFactory],
})
export class AiModule {}
