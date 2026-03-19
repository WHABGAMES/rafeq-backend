/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Message Listener                              ║
 * ║                                                                                ║
 * ║  🔧 FIX BUG-1: الـ AI لا يرد تلقائياً على الرسائل الواردة                     ║
 * ║                                                                                ║
 * ║  يستمع لحدث 'message.received' من MessageService                              ║
 * ║  ويستدعي AIService.generateResponse() لإنشاء رد تلقائي                        ║
 * ║  ثم يرسل الرد عبر MessageService.createOutgoingMessage()                      ║
 * ║                                                                                ║
 * ║  الشروط:                                                                       ║
 * ║  1. المحادثة تحت إدارة الـ AI (handler = 'ai')                                 ║
 * ║  2. الرسالة واردة من العميل (INBOUND)                                          ║
 * ║  3. الرسالة نصية (TEXT)                                                        ║
 * ║  4. إعدادات الـ AI مفعّلة للمتجر                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// ✅ Entities — مطابقة لـ @database/entities/index.ts
import {
  Message,
  MessageDirection,
  MessageType,
  Conversation,
  ConversationHandler,
} from '@database/entities';

// ✅ MessageSender غير مُصدّر من @database/entities/index.ts — نستورده من ملف الـ entity مباشرة
import { MessageSender } from '@database/entities/message.entity';

import { Channel } from '@database/entities';

// Services
import { AIService } from './ai.service';
import { MessageService } from '@modules/messaging/services/message.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface MessageReceivedPayload {
  message: Message;
  conversation: Conversation;
  channel: Channel;
  isNewConversation: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🤖 AI MESSAGE LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AIMessageListener {
  private readonly logger = new Logger(AIMessageListener.name);
  // ✅ In-memory lock: prevents duplicate AI processing when safety net re-emits
  private readonly processingMessages = new Set<string>();

  constructor(
    private readonly aiService: AIService,
    private readonly messageService: MessageService,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
  ) {}

  /**
   * يستمع لكل رسالة واردة ويقرر إذا يجب الرد تلقائياً
   *
   * التدفق:
   * 1. فلترة: هل المحادثة تحت الـ AI؟ هل الرسالة نصية؟
   * 2. جلب إعدادات الـ AI للتأكد أنه مفعّل
   * 3. استدعاء generateResponse() لإنشاء الرد
   * 4. إذا الرد ناجح → إرسال كرسالة صادرة
   * 5. إذا shouldHandoff → لا نرسل رد (handleHandoff يتولى)
   */
  @OnEvent('message.received', { async: true })
  async handleIncomingMessage(payload: MessageReceivedPayload): Promise<void> {
    const { message, conversation } = payload;
    const startTime = Date.now();

    // ✅ Dedup: prevent duplicate processing (safety net re-emit protection)
    if (this.processingMessages.has(message.id)) {
      this.logger.log(`⏭️ Skipping duplicate: message ${message.id} is already being processed`);
      return;
    }
    this.processingMessages.add(message.id);
    // Auto-cleanup after 30s to prevent memory leak
    setTimeout(() => this.processingMessages.delete(message.id), 30000);

    try {
      // ──────────────────────────────────────────────────────────────────────
      // 1. فلترة أساسية
      // ──────────────────────────────────────────────────────────────────────

      // تجاهل الرسائل الصادرة (حماية من loop)
      if (message.direction !== MessageDirection.INBOUND) {
        return;
      }

      // تجاهل الرسائل غير النصية
      if (message.type !== MessageType.TEXT || !message.content?.trim()) {
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 2. جلب إعدادات الـ AI مرة واحدة
      // ──────────────────────────────────────────────────────────────────────

      const storeId = payload.channel?.storeId;
      const settings = await this.aiService.getSettings(conversation.tenantId, storeId);

      if (!settings.enabled) {
        this.logger.log(`⏭️ Skipping AI: bot is DISABLED for tenant ${conversation.tenantId}`);
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // 3. التحقق من حالة المحادثة مع دعم انتهاء مدة السكوت
      // ──────────────────────────────────────────────────────────────────────

      if (conversation.handler !== ConversationHandler.AI) {
        if (settings.silenceOnHandoff && conversation.handler === ConversationHandler.HUMAN) {
          const aiContext = (conversation.aiContext || {}) as Record<string, unknown>;
          const handoffAt = aiContext.handoffAt as string | undefined;
          const silenceMinutes = settings.silenceDurationMinutes || 60;

          let silenceExpired = false;
          if (handoffAt) {
            const elapsed = (Date.now() - new Date(handoffAt).getTime()) / 60000;
            silenceExpired = elapsed >= silenceMinutes;
          } else {
            silenceExpired = true;
          }

          if (silenceExpired) {
            this.logger.log(`⏰ Silence expired for conversation ${conversation.id} — re-enabling AI (was ${silenceMinutes}min)`);
            await this.conversationRepo.update({ id: conversation.id }, { handler: ConversationHandler.AI });
            conversation.handler = ConversationHandler.AI;
          } else {
            this.logger.log(`⏭️ Skipping AI: conversation ${conversation.id} handler=human, silence NOT expired yet`);
            return;
          }
        } else {
          this.logger.log(`⏭️ Skipping AI: conversation ${conversation.id} handler=${conversation.handler} (not AI)`);
          return;
        }
      }

      // ──────────────────────────────────────────────────────────────────────
      // 4. إنشاء رد الـ AI
      // ──────────────────────────────────────────────────────────────────────

      this.logger.log(
        `🤖 Generating AI response for conversation ${conversation.id}`,
      );

      // ✅ لا نرسل رسالة ترحيب ثابتة — GPT يتعامل مع التحيات حسب النبرة تلقائياً

      const aiResponse = await this.aiService.generateResponse({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        message: message.content,
      });

      const processingTime = Date.now() - startTime;

      // ──────────────────────────────────────────────────────────────────────
      // 4. إرسال الرد
      // ──────────────────────────────────────────────────────────────────────

      // إذا تم التحويل للبشري
      if (aiResponse.shouldHandoff) {
        if (aiResponse.reply) {
          await this.messageService.createOutgoingMessage({
            conversationId: conversation.id,
            content: aiResponse.reply,
            type: MessageType.TEXT,
            sender: MessageSender.AI,
            aiMetadata: {
              intent: aiResponse.intent || 'HANDOFF',
              confidence: aiResponse.confidence,
              toolsCalled: aiResponse.toolsUsed,
              processingTime,
              ragAudit: aiResponse.ragAudit || undefined,
            },
          });
        }

        this.logger.log(
          `🔄 AI handoff for conversation ${conversation.id}: ${aiResponse.handoffReason}`,
        );
        return;
      }

      // رد عادي
      if (aiResponse.reply) {
        await this.messageService.createOutgoingMessage({
          conversationId: conversation.id,
          content: aiResponse.reply,
          type: MessageType.TEXT,
          sender: MessageSender.AI,
          aiMetadata: {
            intent: aiResponse.intent,
            confidence: aiResponse.confidence,
            toolsCalled: aiResponse.toolsUsed,
            processingTime,
            ragAudit: aiResponse.ragAudit || undefined,
          },
        });

        this.logger.log(
          `✅ AI response sent for conversation ${conversation.id} ` +
            `(confidence: ${aiResponse.confidence}, time: ${processingTime}ms)`,
        );
      } else {
        this.logger.warn(
          `⚠️ AI returned empty reply for conversation ${conversation.id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ AI auto-response failed for conversation ${conversation?.id}`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          messageId: message?.id,
        },
      );
      // لا نعيد الخطأ — لا نريد أن يؤثر فشل الـ AI على حفظ الرسالة
    }
  }
}
