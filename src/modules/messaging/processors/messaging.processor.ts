/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Messaging Queue Processor                        ║
 * ║                                                                                ║
 * ║  ✅ يعالج jobs من queue 'messaging':                                           ║
 * ║     - send-message: إرسال فعلي عبر WhatsApp/Discord                           ║
 * ║     - process-incoming: معالجة إضافية للرسائل الواردة                          ║
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

// Entities
import {
  Message,
  MessageStatus,
  Conversation,
  Channel,
} from '@database/entities';

// ChannelsService: الإرسال الفعلي عبر واتساب
import { ChannelsService } from '../../channels/channels.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 JOB INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface SendMessageJobData {
  messageId: string;
  conversationId: string;
  channelId: string;
}

interface ProcessIncomingJobData {
  messageId: string;
  conversationId: string;
  channelId: string;
  tenantId: string;
  isNewConversation: boolean;
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

    private readonly channelsService: ChannelsService,
  ) {
    super();
    this.logger.log('🚀 MessagingProcessor initialized — listening on queue: messaging');
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'send-message':
        return this.handleSendMessage(job as Job<SendMessageJobData>);

      case 'process-incoming':
        return this.handleProcessIncoming(job as Job<ProcessIncomingJobData>);

      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
        return { status: 'unknown_job_type' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📤 SEND MESSAGE — الإرسال الفعلي عبر WhatsApp
  // ═══════════════════════════════════════════════════════════════════════════

  private async handleSendMessage(
    job: Job<SendMessageJobData>,
  ): Promise<{ status: string; externalId?: string }> {
    const { messageId, conversationId, channelId } = job.data;

    this.logger.log(`📤 [send-message] Job picked up — messageId: ${messageId}`);

    try {
      // 1️⃣ تحميل البيانات
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

      // 2️⃣ تحديد المستقبل (رقم العميل)
      const rawRecipient = conversation.customerExternalId || conversation.customerPhone;

      if (!rawRecipient) {
        this.logger.error(`No recipient for conversation: ${conversationId}`);
        await this.messageRepo.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: 'No recipient phone number',
        });
        return { status: 'no_recipient' };
      }

      // ✅ تنظيف الرقم من @lid, @s.whatsapp.net, @c.us
      const recipient = rawRecipient.split('@')[0].replace(/\D/g, '') || rawRecipient;

      this.logger.log(
        `📤 Sending to: ${recipient} | Channel: ${channel.type} | isWhatsApp: ${channel.isWhatsApp} | Content: "${(message.content || '').substring(0, 50)}..."`,
      );

      // 3️⃣ الإرسال الفعلي
      let externalId: string | undefined;

      if (channel.isWhatsApp) {
        const result = await this.channelsService.sendWhatsAppMessage(
          channel.id,
          recipient,
          message.content || '',
        );
        externalId = result?.messageId;
      } else {
        // قنوات أخرى — event لحين بناء الإرسال المباشر
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

      this.logger.log(`✅ Message ${messageId} sent to ${recipient} via ${channel.type}`);

      return { status: 'sent', externalId };

    } catch (error) {
      this.logger.error(`❌ Failed to send message: ${messageId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });

      await this.messageRepo.update(messageId, {
        status: MessageStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Send failed',
      });

      throw error; // BullMQ will retry
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 PROCESS INCOMING — معالجة إضافية للرسائل الواردة
  // ═══════════════════════════════════════════════════════════════════════════

  private async handleProcessIncoming(
    job: Job<ProcessIncomingJobData>,
  ): Promise<{ status: string }> {
    const { messageId, conversationId, isNewConversation } = job.data;

    this.logger.debug(
      `📥 [process-incoming] messageId: ${messageId}, isNew: ${isNewConversation}`,
    );

    // المعالجة الإضافية تحصل عبر EventEmitter (مثل AI auto-reply)
    // هذا الـ job يضمن أن الأحداث تُعالج حتى لو حصل خطأ

    return { status: 'processed' };
  }
}
