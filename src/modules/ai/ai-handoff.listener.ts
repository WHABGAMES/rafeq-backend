/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - AI Handoff Notification Listener                     ║
 * ║                                                                                ║
 * ║  🔔 يرسل إشعارات واتساب للموظفين عند التحويل البشري                          ║
 * ║                                                                                ║
 * ║  التدفق:                                                                      ║
 * ║  AI يحوّل لبشري → ai.service يطلق 'ai.handoff'                               ║
 * ║       ↓                                                                        ║
 * ║  هذا الـ Listener يستقبل الحدث                                                ║
 * ║       ↓                                                                        ║
 * ║  يرسل رسالة واتساب لكل رقم في handoffNotifyPhones                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Conversation } from '@database/entities';
import { ChannelsService } from '../channels/channels.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface AIHandoffEvent {
  conversationId: string;
  tenantId: string;
  customerId: string;
  customerName?: string;
  channel: string;        // channelId UUID
  reason: string;
  handoffAt: string;
  notifyEmployeeIds: string[];
  notifyPhones: string[];
  notifyEmails: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔔 AI HANDOFF LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AIHandoffListener {
  private readonly logger = new Logger(AIHandoffListener.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,

    private readonly channelsService: ChannelsService,
  ) {}

  /**
   * 🔔 عند تحويل محادثة من AI إلى بشري:
   * 1. يبني رسالة إشعار بتفاصيل المحادثة
   * 2. يرسل واتساب لكل رقم مسجل في إعدادات التحويل
   */
  @OnEvent('ai.handoff', { async: true })
  async handleHandoff(event: AIHandoffEvent): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log('🔔 Handoff notification triggered', {
        conversationId: event.conversationId,
        reason: event.reason,
        notifyPhones: event.notifyPhones?.length || 0,
      });

      // ═══════════════════════════════════════════════════════════════════
      // 1️⃣ التحقق من وجود أرقام للإشعار
      // ═══════════════════════════════════════════════════════════════════
      const phonesToNotify = event.notifyPhones?.filter(p => p?.trim()) || [];

      if (phonesToNotify.length === 0) {
        this.logger.warn('⚠️ No notification phones configured — skipping WhatsApp notifications');
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // 2️⃣ البحث عن المحادثة والقناة
      // ═══════════════════════════════════════════════════════════════════
      let channelId = event.channel; // channelId من الـ context

      // إذا لم يكن channelId متاحاً من الحدث → نجلبه من المحادثة
      if (!channelId) {
        const conv = await this.conversationRepo.findOne({
          where: { id: event.conversationId },
          select: ['id', 'channelId'],
        });

        if (!conv?.channelId) {
          this.logger.warn('⚠️ No channel found for conversation — cannot send notifications');
          return;
        }

        channelId = conv.channelId;
      }

      // ═══════════════════════════════════════════════════════════════════
      // 3️⃣ بناء رسالة الإشعار
      // ═══════════════════════════════════════════════════════════════════
      const reasonText = this.translateReason(event.reason);
      const timeText = new Date().toLocaleString('ar-SA', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      });

      const notificationMessage =
        `🔔 *تحويل بشري جديد!*\n\n` +
        `👤 العميل: ${event.customerName || 'غير معروف'}\n` +
        `📝 السبب: ${reasonText}\n` +
        `⏰ الوقت: ${timeText}\n\n` +
        `💬 يرجى فتح لوحة التحكم للرد على العميل.`;

      // ═══════════════════════════════════════════════════════════════════
      // 4️⃣ إرسال الإشعار لكل رقم
      // ═══════════════════════════════════════════════════════════════════
      let successCount = 0;
      let failCount = 0;

      for (const phone of phonesToNotify) {
        try {
          const cleanPhone = phone.replace(/[^0-9+]/g, '');
          
          await this.channelsService.sendWhatsAppMessage(
            channelId,
            cleanPhone,
            notificationMessage,
          );

          successCount++;
          this.logger.debug(`✅ Notification sent to ${cleanPhone}`);
        } catch (error) {
          failCount++;
          this.logger.error(`❌ Failed to notify ${phone}`, {
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      }

      this.logger.log(`🔔 Handoff notifications: ${successCount} sent, ${failCount} failed`, {
        conversationId: event.conversationId,
        duration: `${Date.now() - startTime}ms`,
      });

    } catch (error) {
      // لا نُسقط العملية الأصلية إذا فشل الإشعار
      this.logger.error('❌ Handoff notification error', {
        error: error instanceof Error ? error.message : 'Unknown',
        conversationId: event.conversationId,
      });
    }
  }

  /**
   * ترجمة سبب التحويل للعربية
   */
  private translateReason(reason: string): string {
    const reasons: Record<string, string> = {
      'CUSTOMER_REQUEST': 'طلب العميل التحدث مع موظف',
      'MAX_FAILURES': 'تجاوز عدد المحاولات الفاشلة',
      'NO_MATCH_AFTER_MAX_ATTEMPTS': 'لم يتم العثور على إجابة بعد استنفاد المحاولات',
      'KEYWORD_MATCH': 'كلمة مفتاحية للتحويل',
      'TOOL_FAILURE': 'فشل في تنفيذ الأداة',
      'LOW_CONFIDENCE': 'ثقة منخفضة في الرد',
      'AI_ERROR': 'خطأ في نظام الذكاء الاصطناعي',
      'AI_NOT_CONFIGURED': 'نظام الذكاء الاصطناعي غير مُعدّ',
    };

    return reasons[reason] || reason || 'تحويل تلقائي';
  }
}
