/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Messaging Queue Processor                        ║
 * ║                                                                                ║
 * ║  🔧 v2 Fixes:                                                                  ║
 * ║  - BUG-6:  process-incoming + send-message بدون Processor                     ║
 * ║  - SEND:   إرسال فعلي عبر ChannelsService بدلاً من event وهمي                 ║
 * ║                                                                                ║
 * ║  ✅ يتبع نفس نمط notification.processor.ts (BullMQ + WorkerHost)              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities — مطابقة لـ @database/entities/index.ts
import {
  Message,
  MessageStatus,
  Conversation,
  Channel,
} from '@database/entities';

// ✅ ChannelsService: الإرسال الفعلي عبر واتساب/ديسكورد/...
import { ChannelsService } from '../../channels/channels.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 JOB INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface ProcessIncomingJobData {
  messageId: string;
  conversationId: string;
  channelId: string;
  tenantId: string;
  isNewConversation: boolean;
}

interface SendMessageJobData {
  messageId: string;
  conversationId: string;
  channelId: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ⚙️ PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

@Processor('messaging')
export class MessagingProcessor extends WorkerHost {
  private readonly logger = new Logger(MessagingProcessor.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,

    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    private readonly eventEmitter: EventEmitter2,

    // ✅ إرسال فعلي عبر القنوات
    private readonly channelsService: ChannelsService,
  ) {
    super();
    this.logger.log('🚀 MessagingProcessor initialized — listening on queue: messaging');
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'process-incoming':
        return this.handleProcessIncoming(job as Job<ProcessIncomingJobData>);

      case 'send-message':
        return this.handleSendMessage(job as Job<SendMessageJobData>);

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        return { status: 'skipped', reason: 'unknown_job_name' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 PROCESS INCOMING
  // ═══════════════════════════════════════════════════════════════════════════

  private async handleProcessIncoming(
    job: Job<ProcessIncomingJobData>,
  ): Promise<{ status: string }> {
    const { messageId, conversationId, tenantId, isNewConversation } = job.data;

    this.logger.debug(`Processing incoming message: ${messageId}`);

    try {
      const message = await this.messageRepo.findOne({
        where: { id: messageId },
      });

      if (!message) {
        this.logger.warn(`Message not found: ${messageId}`);
        return { status: 'message_not_found' };
      }

      const conversation = await this.conversationRepo.findOne({
        where: { id: conversationId },
      });

      if (!conversation) {
        this.logger.warn(`Conversation not found: ${conversationId}`);
        return { status: 'conversation_not_found' };
      }

      // إطلاق أحداث للوحدات الأخرى (automations, notifications...)
      this.eventEmitter.emit('message.processed', {
        message,
        conversation,
        tenantId,
        isNewConversation,
      });

      if (isNewConversation) {
        this.eventEmitter.emit('conversation.created', {
          conversation,
          tenantId,
          firstMessage: message,
        });
      }

      return { status: 'processed' };
    } catch (error) {
      this.logger.error(`Failed to process incoming message: ${messageId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error; // BullMQ will retry
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📤 SEND MESSAGE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * إرسال الرسائل الصادرة عبر القناة المناسبة
   *
   * ✅ يستخدم ChannelsService.sendWhatsAppMessage() مباشرة
   */
  private async handleSendMessage(
    job: Job<SendMessageJobData>,
  ): Promise<{ status: string; externalId?: string }> {
    const { messageId, conversationId, channelId } = job.data;

    this.logger.log(`📤 [send-message] Job picked up — messageId: ${messageId}, channelId: ${channelId}`);

    try {
      // 1️⃣ تحميل البيانات
      const message = await this.messageRepo.findOne({
        where: { id: messageId },
      });

      if (!message) {
        this.logger.warn(`Message not found for sending: ${messageId}`);
        return { status: 'message_not_found' };
      }

      const conversation = await this.conversationRepo.findOne({
        where: { id: conversationId },
      });

      if (!conversation) {
        this.logger.warn(`Conversation not found: ${conversationId}`);
        await this.messageRepo.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: 'Conversation not found',
        });
        return { status: 'conversation_not_found' };
      }

      const channel = await this.channelRepo.findOne({
        where: { id: channelId },
      });

      if (!channel) {
        this.logger.warn(`Channel not found: ${channelId}`);
        await this.messageRepo.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: 'Channel not found',
        });
        return { status: 'channel_not_found' };
      }

      // 2️⃣ تحديد المستقبل (رقم العميل) + تنظيف من JID format
      const rawRecipient = conversation.customerExternalId || conversation.customerPhone;

      if (!rawRecipient) {
        this.logger.error(`No recipient found for conversation: ${conversationId}`);
        await this.messageRepo.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: 'No recipient phone number',
        });
        return { status: 'no_recipient' };
      }

      // تنظيف الرقم من @lid, @s.whatsapp.net, @c.us
      const recipient = rawRecipient.split('@')[0].replace(/\D/g, '') || rawRecipient;

      this.logger.log(
        `📤 Sending to: ${recipient} | Channel: ${channel.type} | isWhatsApp: ${channel.isWhatsApp} | Content: "${(message.content || '').substring(0, 50)}..."`,
      );

      // 3️⃣ الإرسال الفعلي عبر القناة
      let externalId: string | undefined;

      if (channel.isWhatsApp) {
        // ✅ واتساب (رسمي + QR) — إرسال فعلي عبر ChannelsService
        const result = await this.channelsService.sendWhatsAppMessage(
          channel.id,
          recipient,
          message.content || '',
        );
        externalId = result?.messageId;
      } else {
        // قنوات أخرى (Discord, Telegram...) — event لحين بناء الإرسال المباشر
        this.eventEmitter.emit(`channel.${channel.type}.send`, {
          message,
          channel,
          conversation,
          recipient,
        });
      }

      // 4️⃣ تحديث حالة الرسالة
      await this.messageRepo.update(messageId, {
        status: MessageStatus.SENT,
        sentAt: new Date(),
        ...(externalId ? { externalId } : {}),
      });

      this.logger.log(
        `✅ Message ${messageId} sent to ${recipient} via ${channel.type}`,
        { externalId },
      );

      return { status: 'sent', externalId };
    } catch (error) {
      this.logger.error(`❌ Failed to send message: ${messageId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });

      await this.messageRepo.update(messageId, {
        status: MessageStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Send failed',
      });

      throw error; // BullMQ will retry
    }
  }
}
