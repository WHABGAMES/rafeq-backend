/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - AI Message Listener v3                           ║
 * ║                                                                                ║
 * ║  ✅ v3: Message Batching — تجميع رسائل العميل والرد مرة واحدة                 ║
 * ║                                                                                ║
 * ║  المشكلة: العميل يرسل "سلام" ثم "كيف حالكم" ثم "وين طلبي"                  ║
 * ║           البوت يرد 3 مرات منفصلة = مزعج + يستهلك رصيد GPT                   ║
 * ║                                                                                ║
 * ║  الحل: البوت ينتظر حتى يسكت العميل (30 ثانية - 5 دقائق)                     ║
 * ║        ثم يقرأ كل الرسائل معاً ويرد رد واحد شامل                             ║
 * ║                                                                                ║
 * ║  النمط: Debounced Response — كل رسالة جديدة تعيد العداد                       ║
 * ║  الافتراضي: 30 ثانية | المدى: 30 ثانية → 5 دقائق                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// ✅ Entities
import {
  Message,
  MessageDirection,
  MessageType,
  Conversation,
  ConversationHandler,
} from '@database/entities';

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

interface BufferedConversation {
  messages: string[];
  conversation: Conversation;
  channel: Channel;
  timer: ReturnType<typeof setTimeout>;
  firstMessageAt: number;
  lastMessageAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🤖 AI MESSAGE LISTENER v3
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AIMessageListener implements OnModuleDestroy {
  private readonly logger = new Logger(AIMessageListener.name);

  // ✅ Dedup: prevents duplicate AI processing
  private readonly processingMessages = new Set<string>();

  // ✅ v3: Message buffer — one per conversation
  private readonly messageBuffer = new Map<string, BufferedConversation>();

  // Safety: maximum buffer age (5 min) — even if messages keep coming
  private readonly MAX_BUFFER_AGE_MS = 5 * 60 * 1000;

  constructor(
    private readonly aiService: AIService,
    private readonly messageService: MessageService,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
  ) {}

  /**
   * ✅ Cleanup on shutdown — clear all timers
   */
  onModuleDestroy(): void {
    for (const [, buf] of this.messageBuffer) {
      clearTimeout(buf.timer);
    }
    this.messageBuffer.clear();
    this.logger.log('🧹 Message buffer cleared on shutdown');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 MESSAGE RECEIVED — Entry point
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('message.received', { async: true })
  async handleIncomingMessage(payload: MessageReceivedPayload): Promise<void> {
    const { message, conversation } = payload;

    // ✅ Dedup
    if (this.processingMessages.has(message.id)) {
      return;
    }
    this.processingMessages.add(message.id);
    setTimeout(() => this.processingMessages.delete(message.id), 30000);

    try {
      // ──────────────────────────────────────────────────────────────────
      // 1. فلترة أساسية
      // ──────────────────────────────────────────────────────────────────

      if (message.direction !== MessageDirection.INBOUND) return;
      if (message.type !== MessageType.TEXT || !message.content?.trim()) return;

      // ──────────────────────────────────────────────────────────────────
      // 2. جلب إعدادات الـ AI
      // ──────────────────────────────────────────────────────────────────

      const storeId = payload.channel?.storeId;
      const settings = await this.aiService.getSettings(conversation.tenantId, storeId);

      if (!settings.enabled) {
        this.logger.log(`⏭️ AI DISABLED for tenant ${conversation.tenantId}`);
        return;
      }

      // ──────────────────────────────────────────────────────────────────
      // 2.5 وضع الاختبار
      // ──────────────────────────────────────────────────────────────────

      if (settings.testMode && settings.testPhones?.length) {
        const customerPhone = conversation.customerPhone || '';
        const normalizedPhone = customerPhone.replace(/[^0-9]/g, '');
        const lastNine = (p: string) => p.slice(-9);

        const isTestPhone = settings.testPhones.some((testPhone: string) => {
          const cleanTest = testPhone.replace(/[^0-9]/g, '');
          return normalizedPhone === cleanTest || lastNine(normalizedPhone) === lastNine(cleanTest);
        });

        if (!isTestPhone) {
          this.logger.debug(`🧪 Test mode: skipping ${customerPhone.slice(-4)}****`);
          return;
        }
        this.logger.log(`🧪 Test mode: responding to ${customerPhone.slice(-4)}****`);
      }

      // ──────────────────────────────────────────────────────────────────
      // 3. التحقق من حالة المحادثة
      // ──────────────────────────────────────────────────────────────────

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
            this.logger.log(`⏰ Silence expired for ${conversation.id} — re-enabling AI`);
            await this.conversationRepo.update({ id: conversation.id }, { handler: ConversationHandler.AI });
            conversation.handler = ConversationHandler.AI;
          } else {
            return;
          }
        } else {
          return;
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // 4. ✅ v3: Message Batching — تجميع الرسائل
      // ──────────────────────────────────────────────────────────────────

      const batchingEnabled = settings.messageBatchingEnabled ?? true;
      const batchingSeconds = settings.messageBatchingSeconds ?? 30; // الافتراضي: 30 ثانية

      if (batchingEnabled && batchingSeconds > 0) {
        this.bufferMessage(conversation.id, message.content, conversation, payload.channel, batchingSeconds);
        return; // لا نرد الآن — ننتظر
      }

      // ──────────────────────────────────────────────────────────────────
      // 5. رد فوري (إذا Batching مطفي)
      // ──────────────────────────────────────────────────────────────────

      await this.processAndRespond(conversation, message.content);

    } catch (error) {
      this.logger.error(
        `❌ AI listener error for conv ${conversation?.id}`,
        { error: error instanceof Error ? error.message : 'Unknown' },
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📦 BUFFER MESSAGE — تخزين الرسالة وإعادة ضبط المؤقت
  // ═══════════════════════════════════════════════════════════════════════════

  private bufferMessage(
    conversationId: string,
    content: string,
    conversation: Conversation,
    channel: Channel,
    batchingSeconds: number,
  ): void {
    const existing = this.messageBuffer.get(conversationId);
    const now = Date.now();

    if (existing) {
      // ✅ مسح المؤقت القديم
      clearTimeout(existing.timer);

      // ✅ إضافة الرسالة للمجموعة
      existing.messages.push(content);
      existing.lastMessageAt = now;

      // ✅ Safety: إذا مرّ أكثر من 5 دقائق من أول رسالة → نرد الآن
      if (now - existing.firstMessageAt > this.MAX_BUFFER_AGE_MS) {
        this.logger.log(
          `⏰ Buffer max age reached for ${conversationId} — flushing ${existing.messages.length} messages`,
        );
        this.flushBuffer(conversationId);
        return;
      }

      // ✅ إعادة ضبط المؤقت
      existing.timer = setTimeout(() => this.flushBuffer(conversationId), batchingSeconds * 1000);

      this.logger.debug(
        `📦 Buffered message #${existing.messages.length} for ${conversationId} (waiting ${batchingSeconds}s)`,
      );
    } else {
      // ✅ أول رسالة — إنشاء buffer جديد
      const timer = setTimeout(() => this.flushBuffer(conversationId), batchingSeconds * 1000);

      this.messageBuffer.set(conversationId, {
        messages: [content],
        conversation,
        channel,
        timer,
        firstMessageAt: now,
        lastMessageAt: now,
      });

      this.logger.log(
        `📦 Buffer started for ${conversationId} (waiting ${batchingSeconds}s for more messages)`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚀 FLUSH BUFFER — تفريغ المجموعة وإرسال رد واحد
  // ═══════════════════════════════════════════════════════════════════════════

  private async flushBuffer(conversationId: string): Promise<void> {
    const buf = this.messageBuffer.get(conversationId);
    if (!buf) return;

    // ✅ مسح البافر فوراً (قبل المعالجة) لمنع التكرار
    this.messageBuffer.delete(conversationId);
    clearTimeout(buf.timer);

    const messageCount = buf.messages.length;
    const waitTime = Math.round((buf.lastMessageAt - buf.firstMessageAt) / 1000);

    this.logger.log(
      `🚀 Flushing ${messageCount} batched message(s) for ${conversationId} (collected over ${waitTime}s)`,
    );

    // ✅ دمج كل الرسائل في نص واحد
    // GPT يقرأها كمحادثة متسلسلة ويفهم السياق
    const combinedMessage = buf.messages.join('\n');

    await this.processAndRespond(buf.conversation, combinedMessage);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🤖 PROCESS AND RESPOND — معالجة وإرسال الرد
  // ═══════════════════════════════════════════════════════════════════════════

  private async processAndRespond(
    conversation: Conversation,
    messageContent: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`🤖 Generating AI response for ${conversation.id}`);

      const aiResponse = await this.aiService.generateResponse({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        message: messageContent,
      });

      const processingTime = Date.now() - startTime;

      // ── Handoff response ──
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
        this.logger.log(`🔄 AI handoff for ${conversation.id}: ${aiResponse.handoffReason}`);
        return;
      }

      // ── Normal response ──
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
          `✅ AI response sent for ${conversation.id} (confidence: ${aiResponse.confidence}, time: ${processingTime}ms)`,
        );
      } else {
        this.logger.warn(`⚠️ AI empty reply for ${conversation.id}`);
      }
    } catch (error) {
      this.logger.error(
        `❌ AI response failed for ${conversation.id}`,
        { error: error instanceof Error ? error.message : 'Unknown' },
      );
    }
  }
}
