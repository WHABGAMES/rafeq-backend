/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Module (v5 — Platform-Agnostic)              ║
 * ║                                                                                ║
 * ║  ✅ FIX #7: AI Platform Isolation — لا يستورد SallaApiService مباشرة          ║
 * ║  ✅ FIX BUG1: inject token صحيح getRepositoryToken(Store)                    ║
 * ║  ✅ FIX BUG6: useFactory signature متسقة مع constructor                       ║
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

// Service, Controller & Listeners
import { AIService } from './ai.service';
import { AiController } from './ai.controller';
import { AIMessageListener } from './ai-message.listener';
import { AIHandoffListener } from './ai-handoff.listener';

import { MessagingModule } from '../messaging/messaging.module';
import { ChannelsModule } from '../channels/channels.module';
import { GatewayModule } from '../gateway/gateway.module';
import { MailModule } from '../mail/mail.module';

// ✅ FIX #7: Platform-Agnostic Product Search
import { ProductSearchFactory } from '../../core/ports/product-search.factory';
import { SallaProductSearchAdapter } from '../../integrations/salla/salla-product-search.adapter';
import { ZidProductSearchAdapter } from '../../integrations/zid/zid-product-search.adapter';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeBase,
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
    AIMessageListener,
    AIHandoffListener,

    // ─── Product Search Adapters ───────────────────────────────────────────
    SallaProductSearchAdapter,
    ZidProductSearchAdapter,

    {
      // ✅ FIX BUG1 + BUG6:
      // - inject token صحيح: getRepositoryToken(Store) بدل string literal
      // - useFactory signature: (repo, salla, zid) → new ProductSearchFactory(repo, [...])
      provide: ProductSearchFactory,
      useFactory: (
        storeRepo: Repository<Store>,
        sallaAdapter: SallaProductSearchAdapter,
        zidAdapter: ZidProductSearchAdapter,
      ) => new ProductSearchFactory(storeRepo, [sallaAdapter, zidAdapter]),
      inject: [
        getRepositoryToken(Store),   // ✅ TypeORM token الصحيح
        SallaProductSearchAdapter,
        ZidProductSearchAdapter,
      ],
    },
  ],

  exports: [AIService, ProductSearchFactory],
})
export class AiModule {}
