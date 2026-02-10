/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Messaging Queue Processor                        ║
 * ║                                                                                ║
 * ║  🔧 FIX BUG-6: 'process-incoming' + 'send-message' بدون Processor             ║
 * ║                                                                                ║
 * ║  يعالج الـ jobs المضافة لـ 'messaging' queue:                                  ║
 * ║  - process-incoming: معالجة إضافية للرسائل الواردة + إطلاق أحداث               ║
 * ║  - send-message: إرسال الرسائل الصادرة عبر القناة المناسبة                    ║
 * ║                                                                                ║
 * ║  ✅ يتبع نفس نمط notification.processor.ts (BullMQ + WorkerHost)              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
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
  ) {
    super();
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

  /**
   * معالجة إضافية للرسائل الواردة:
   * - إطلاق أحداث للوحدات الأخرى (automations, notifications...)
   *
   * ملاحظة: رد الـ AI يتم عبر AIMessageListener (حدث message.received)
   * وليس هنا — لأن الحدث أسرع من الـ queue.
   */
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

      // إطلاق أحداث للوحدات الأخرى
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
   * يطلق حدث channel.<type>.send — كل قناة (WhatsApp, Discord...)
   * لها listener خاص يستقبل الحدث ويرسل الرسالة فعلياً.
   */
  private async handleSendMessage(
    job: Job<SendMessageJobData>,
  ): Promise<{ status: string; externalId?: string }> {
    const { messageId, channelId } = job.data;

    this.logger.debug(`Sending message: ${messageId} via channel: ${channelId}`);

    try {
      const message = await this.messageRepo.findOne({
        where: { id: messageId },
      });

      if (!message) {
        this.logger.warn(`Message not found for sending: ${messageId}`);
        return { status: 'message_not_found' };
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

      // إطلاق حدث الإرسال للقناة المناسبة
      this.eventEmitter.emit(`channel.${channel.type}.send`, {
        message,
        channel,
      });

      // تحديث الحالة
      await this.messageRepo.update(messageId, {
        status: MessageStatus.SENT,
        sentAt: new Date(),
      });

      this.logger.debug(`✅ Message ${messageId} dispatched via ${channel.type}`);

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(`Failed to send message: ${messageId}`, {
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
