/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Messaging Queue Processor                        ║
 * ║                                                                                ║
 * ║  ✅ يعالج jobs من queue 'messaging':                                           ║
 * ║     - send-message: إرسال فعلي عبر WhatsApp (safety net فقط)                 ║
 * ║     - process-incoming: معالجة إضافية للرسائل الواردة                          ║
 * ║                                                                                ║
 * ║  📌 ملاحظة: الإرسال الأساسي يتم مباشرة في MessageService.createOutgoingMessage ║
 * ║     هذا الـ processor يُستخدم كـ fallback فقط                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities
import {
  Message,
  MessageStatus,
  MessageDirection,
  MessageType,
  MessageSender,
  Conversation,
  ConversationHandler,
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
      // ✅ استخدام customerExternalId (الـ JID الأصلي) للإرسال
      // whatsapp-baileys.service سيحوّل @lid → @s.whatsapp.net إذا توفر الربط
      const rawRecipient = conversation.customerExternalId || conversation.customerPhone;

      if (!rawRecipient) {
        this.logger.error(`No recipient for conversation: ${conversationId}`);
        await this.messageRepo.update(messageId, {
          status: MessageStatus.FAILED,
          errorMessage: 'No recipient phone number',
        });
        return { status: 'no_recipient' };
      }

      // ✅ الاحتفاظ بالـ JID كاملاً — formatJid يتعامل مع الصيغتين
      const recipient = rawRecipient;

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

        // ✅ واتساب لازم يرجع messageId حقيقي
        if (!externalId) {
          throw new Error(`WhatsApp returned no messageId for ${recipient}`);
        }
      } else {
        this.eventEmitter.emit(`channel.${channel.type}.send`, {
          message,
          channel,
          conversation,
          recipient,
        });
      }

      // 4️⃣ تحديث حالة الرسالة — فقط بعد التأكيد
      await this.messageRepo.update(messageId, {
        status: MessageStatus.SENT,
        sentAt: new Date(),
        ...(externalId ? { externalId } : {}),
      });

      this.logger.log(`✅ Message ${messageId} CONFIRMED sent | externalId: ${externalId}`);

      return { status: 'sent', externalId };

    } catch (error) {
      this.logger.error(`❌ Failed to send message: ${messageId}`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });

      // ✅ تحديث الحالة إلى FAILED
      await this.messageRepo.update(messageId, {
        status: MessageStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Send failed',
      });

      throw error; // BullMQ will retry if attempts remain
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 PROCESS INCOMING — شبكة أمان: يتحقق إذا AI رد على الرسالة
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * يعمل بعد 5 ثواني من حفظ الرسالة الواردة.
   * يتحقق: هل AI رد على هالرسالة؟
   * إذا لا (حدث ضياع EventEmitter بسبب Bad MAC أو غيره) → يعيد إطلاق الحدث.
   *
   * هذا يحل مشكلة:
   * - Bad MAC errors اللي تسبب ضياع EventEmitter
   * - أي crash أو خطأ بين حفظ الرسالة وإطلاق الحدث
   * - race conditions مع Baileys duplicate messages
   */
  private async handleProcessIncoming(
    job: Job<ProcessIncomingJobData>,
  ): Promise<{ status: string }> {
    const { messageId, conversationId, channelId } = job.data;

    try {
      // 1. Load the incoming message
      const message = await this.messageRepo.findOne({ where: { id: messageId } });
      if (!message) {
        return { status: 'message_not_found' };
      }

      // 2. Skip if not inbound text (AI only responds to text)
      if (message.direction !== MessageDirection.INBOUND || message.type !== MessageType.TEXT) {
        return { status: 'not_ai_eligible' };
      }

      // 3. Load conversation
      const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
      if (!conversation) {
        return { status: 'conversation_not_found' };
      }

      // 4. Skip if not AI-handled
      if (conversation.handler !== ConversationHandler.AI) {
        return { status: 'not_ai_handled' };
      }

      // 5. Check if AI already responded AFTER this message
      const aiResponse = await this.messageRepo.findOne({
        where: {
          conversationId,
          sender: MessageSender.AI,
          createdAt: MoreThan(message.createdAt),
        },
        order: { createdAt: 'ASC' },
      });

      if (aiResponse) {
        // AI already responded — EventEmitter worked fine
        return { status: 'ai_already_responded' };
      }

      // 6. ⚠️ AI did NOT respond — re-emit the event
      this.logger.warn(
        `🔄 [SAFETY NET] AI did not respond to message ${messageId} within 15s — re-emitting event`,
      );

      const channel = await this.channelRepo.findOne({ where: { id: channelId } });
      if (!channel) {
        return { status: 'channel_not_found' };
      }

      this.eventEmitter.emit('message.received', {
        message,
        conversation,
        channel,
        isNewConversation: false,
      });

      this.logger.log(
        `✅ [SAFETY NET] Re-emitted message.received for ${messageId} — AI should now respond`,
      );

      return { status: 'ai_re_triggered' };

    } catch (error: any) {
      this.logger.error(
        `❌ [SAFETY NET] Failed for message ${messageId}: ${error.message}`,
      );
      throw error; // BullMQ will retry
    }
  }
}
