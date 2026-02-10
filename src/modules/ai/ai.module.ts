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
import { KnowledgeBase } from './entities/knowledge-base.entity';

// Service, Controller & Listener
import { AIService } from './ai.service';
import { AiController } from './ai.controller';
import { AIMessageListener } from './ai-message.listener';

// ✅ BUG-1: MessagingModule مطلوب لـ AIMessageListener → MessageService
import { MessagingModule } from '../messaging/messaging.module';

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
      // ❌ BUG-14 FIX: حذف Customer — غير مستخدم في ai.service.ts
    ]),

    // ❌ BUG-12 FIX: حذف HttpModule — الـ service يستخدم openai npm package مباشرة
    // ❌ BUG-13 FIX: حذف BullModule('ai-processing') — لا يوجد processor يستخدمه

    // ✅ BUG-1 FIX: MessagingModule يوفر MessageService للـ AIMessageListener
    forwardRef(() => MessagingModule),

    ConfigModule,
  ],

  controllers: [AiController],

  providers: [
    AIService,
    AIMessageListener, // ✅ BUG-1 FIX: الرد التلقائي على الرسائل الواردة
  ],

  exports: [AIService],
})
export class AiModule {}
