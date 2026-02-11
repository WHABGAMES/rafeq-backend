/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Module (Production v3)                        ║
 * ║                                                                                ║
 * ║  ✅ يسجل جميع الـ entities المطلوبة لـ ai.service.ts                          ║
 * ║  ✅ AIMessageListener يربط الرسائل الواردة بالـ AI تلقائياً                    ║
 * ║                                                                                ║
 * ║  🔧 v3 Fixes:                                                                  ║
 * ║  - BUG-1:  إضافة AIMessageListener (الرد التلقائي)                            ║
 * ║  - BUG-12: إزالة HttpModule غير المستخدم                                       ║
 * ║  - BUG-13: إزالة BullModule('ai-processing') غير المستخدم                     ║
 * ║  - BUG-14: إزالة Customer entity غير المستخدم                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

// ✅ Entities — فقط المستخدمة فعلياً في ai.service.ts
import { Message, Conversation, Order } from '@database/entities';
import { StoreSettings } from '../settings/entities/store-settings.entity';
import { Store } from '../stores/entities/store.entity';
import { KnowledgeBase } from './entities/knowledge-base.entity';

// Service, Controller & Listeners
import { AIService } from './ai.service';
import { AiController } from './ai.controller';
import { AIMessageListener } from './ai-message.listener';
import { AIHandoffListener } from './ai-handoff.listener';

// ✅ BUG-1: MessagingModule مطلوب لـ AIMessageListener → MessageService
import { MessagingModule } from '../messaging/messaging.module';

// ✅ ChannelsModule مطلوب لـ AIHandoffListener → إرسال إشعارات واتساب
import { ChannelsModule } from '../channels/channels.module';

// ✅ المهمة 6: GatewayModule مطلوب لـ AIHandoffListener → WebSocket events
import { GatewayModule } from '../gateway/gateway.module';

// ✅ المهمة 6: MailModule مطلوب لـ AIHandoffListener → إرسال إيميل
import { MailModule } from '../mail/mail.module';

// ✅ StoresModule مطلوب للبحث في منتجات سلة
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════════════
    // 📁 Database — فقط الـ entities المستخدمة في ai.service.ts
    // ═══════════════════════════════════════════════════════════════════════════
    TypeOrmModule.forFeature([
      KnowledgeBase, // مكتبة المعلومات
      StoreSettings, // إعدادات البوت (settingsKey='ai')
      Conversation, // المحادثات (handler, aiContext, etc.)
      Message, // الرسائل (direction, aiMetadata, etc.)
      Order, // الطلبات (tool: get_order_status)
      Store, // المتاجر (للبحث في منتجات سلة)
      // ❌ BUG-14 FIX: حذف Customer — غير مستخدم في ai.service.ts
    ]),

    // ❌ BUG-12 FIX: حذف HttpModule — الـ service يستخدم openai npm package مباشرة
    // ❌ BUG-13 FIX: حذف BullModule('ai-processing') — لا يوجد processor يستخدمه

    // ✅ BUG-1 FIX: MessagingModule يوفر MessageService للـ AIMessageListener
    forwardRef(() => MessagingModule),

    // ✅ ChannelsModule يوفر ChannelsService لإرسال إشعارات التحويل البشري
    ChannelsModule,

    // ✅ المهمة 6: WebSocket events عبر Gateway
    GatewayModule,

    // ✅ المهمة 6: إشعارات إيميل عند التحويل البشري
    MailModule,

    // ✅ StoresModule: يوفر SallaApiService للبحث في منتجات سلة
    StoresModule,

    ConfigModule,
  ],

  controllers: [AiController],

  providers: [
    AIService,
    AIMessageListener,    // ✅ الرد التلقائي على الرسائل الواردة
    AIHandoffListener,    // ✅ إشعارات واتساب عند التحويل البشري
  ],

  exports: [AIService],
})
export class AiModule {}
