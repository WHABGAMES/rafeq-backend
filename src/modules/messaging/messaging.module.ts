/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Messaging Module                          ║
 * ║                                                                                ║
 * ║  🔧 v4 Fixes:                                                                  ║
 * ║  - BUG-6:  MessagingProcessor لمعالجة queue jobs                              ║
 * ║  - BRIDGE: ChannelMessageListener يربط أحداث القنوات بالرسائل                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

// Entities
import { Message, Conversation, Customer, Channel } from '@database/entities';
import { Store } from '../stores/entities/store.entity';

// Services
import { MessageService } from './services/message.service';
import { ConversationManagerService } from './services/conversation-manager.service';

// ✅ BUG-6 FIX: Queue Processor
import { MessagingProcessor } from './processors/messaging.processor';

// ✅ BRIDGE: يربط أحداث واتساب/ديسكورد بنظام الرسائل والذكاء الاصطناعي
import { ChannelMessageListener } from './listeners/channel-message.listener';

// ✅ SEND: Processor يحتاج ChannelsService لإرسال الرسائل فعلياً
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      Conversation,
      Customer,
      Channel,
      Store, // ✅ مطلوب لـ ChannelMessageListener (channel → store → tenantId)
    ]),

    BullModule.registerQueue({
      name: 'messaging',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          count: 500,
          age: 12 * 3600,
        },
      },
    }),

    ConfigModule,

    // ✅ ChannelsModule يوفر ChannelsService للـ Processor (إرسال واتساب فعلي)
    // ChannelsModule لا يستورد MessagingModule — لا يوجد circular dependency
    forwardRef(() => ChannelsModule),
  ],

  providers: [
    MessageService,
    ConversationManagerService,
    MessagingProcessor,        // ✅ BUG-6: process-incoming + send-message
    ChannelMessageListener,    // ✅ BRIDGE: channel events → message processing → AI
  ],

  exports: [MessageService, ConversationManagerService],
})
export class MessagingModule {}
