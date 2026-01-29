/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Messaging Module                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

// Entities
import { Message, Conversation, Customer, Channel } from '@database/entities';

// Services
import { MessageService } from './services/message.service';
import { ConversationManagerService } from './services/conversation-manager.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      Conversation,
      Customer,
      Channel,
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
  ],

  providers: [
    MessageService,
    ConversationManagerService,
  ],

  exports: [
    MessageService,
    ConversationManagerService,
  ],
})
export class MessagingModule {}
