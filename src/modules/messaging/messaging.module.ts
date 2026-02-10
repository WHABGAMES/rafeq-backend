/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Messaging Module                          ║
 * ║                                                                                ║
 * ║  ✅ v2: يسجل MessagingProcessor لمعالجة queue jobs                            ║
 * ║  ✅ v2: يستورد ChannelsModule للإرسال الفعلي عبر WhatsApp                     ║
 * ║  ✅ v3: يسجل ChannelMessageListener — الجسر المفقود!                          ║
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

// Processor
import { MessagingProcessor } from './processors/messaging.processor';

// ✅ Listener — الجسر بين أحداث القنوات ونظام الرسائل
import { ChannelMessageListener } from './listeners/channel-message.listener';

// ChannelsModule — للإرسال الفعلي عبر WhatsApp
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      Conversation,
      Customer,
      Channel,
      Store,
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

    // ✅ ChannelsModule يُصدّر ChannelsService المطلوب للـ processor
    forwardRef(() => ChannelsModule),
  ],

  providers: [
    MessageService,
    ConversationManagerService,
    MessagingProcessor,          // ✅ يعالج send-message + process-incoming
    ChannelMessageListener,      // ✅ يربط أحداث القنوات بنظام الرسائل
  ],

  exports: [
    MessageService,
    ConversationManagerService,
  ],
})
export class MessagingModule {}
