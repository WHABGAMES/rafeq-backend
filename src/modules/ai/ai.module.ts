/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Module (Production v2)                        ║
 * ║                                                                                ║
 * ║  ✅ يسجل جميع الـ entities المطلوبة لـ ai.service.ts                          ║
 * ║  ✅ KnowledgeBase + StoreSettings + Channel + Conversation + Message + Order   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

// ✅ Entities
import { Message, Conversation, Customer, Order, Channel } from '@database/entities';
import { StoreSettings } from '../settings/entities/store-settings.entity';
import { KnowledgeBase } from './entities/knowledge-base.entity';

// Service & Controller
import { AIService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════════════
    // 📁 Database — جميع الـ entities التي يستخدمها ai.service.ts
    // ═══════════════════════════════════════════════════════════════════════════
    TypeOrmModule.forFeature([
      KnowledgeBase,    // مكتبة المعلومات
      StoreSettings,    // إعدادات البوت (settingsKey='ai')
      Conversation,     // المحادثات
      Message,          // الرسائل
      Order,            // الطلبات (tool: get_order_status)
      Channel,          // القنوات (للربط بين conversation → storeId)
      Customer,         // بيانات العملاء
    ]),

    // 🌐 HTTP for OpenAI
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: 'https://api.openai.com/v1',
        timeout: 60000,
        headers: {
          'Authorization': `Bearer ${configService.get('ai.apiKey')}`,
          'Content-Type': 'application/json',
        },
      }),
    }),

    // 📬 Queue
    BullModule.registerQueue({
      name: 'ai-processing',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600, count: 100 },
      },
    }),

    ConfigModule,
  ],

  controllers: [AiController],
  providers: [AIService],
  exports: [AIService],
})
export class AiModule {}
