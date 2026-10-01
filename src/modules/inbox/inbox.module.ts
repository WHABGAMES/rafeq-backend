/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Inbox Module (Production v2)                     ║
 * ║                                                                                ║
 * ║  🔧 v2 Fix: إضافة MessagingModule لتوفير MessageService                       ║
 * ║  → يسمح بإرسال الرسائل من صفحة المحادثات                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Conversation, Message, User, Customer } from '@database/entities';
import { InboxService } from './inbox.service';
import { InboxController } from './inbox.controller';

// ✅ BUG-INB3 FIX: MessagingModule يوفر MessageService لإرسال الرسائل
import { MessagingModule } from '../messaging/messaging.module';
import { PlatformCapabilitiesModule } from '../platform-capabilities/platform-capabilities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      User,
      Customer,
    ]),

    ConfigModule,

    // ✅ MessagingModule يصدّر MessageService
    // نستخدم forwardRef لتجنب circular dependency
    forwardRef(() => MessagingModule),
    PlatformCapabilitiesModule,
  ],

  controllers: [InboxController],

  providers: [InboxService],

  exports: [InboxService],
})
export class InboxModule {}
