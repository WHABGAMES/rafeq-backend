/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - AI Handoff Notification Listener                     ║
 * ║                                                                                ║
 * ║  🔔 عند التحويل البشري:                                                       ║
 * ║     1. ✅ emit WebSocket event عبر Gateway                                    ║
 * ║     2. ✅ يرسل إشعار واتساب للموظفين                                          ║
 * ║     3. ✅ يرسل إشعار إيميل إذا notifyEmails موجود                             ║
 * ║                                                                                ║
 * ║  الإشعار يحتوي:                                                               ║
 * ║     customer_name, customer_phone, conversation_id, dashboard_link, reason    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Conversation } from '@database/entities';
import { ChannelsService } from '../channels/channels.service';
import { AppGateway } from '../gateway/app.gateway';
import { MailService } from '../mail/mail.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface AIHandoffEvent {
  conversationId: string;
  tenantId: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  channel: string;
  reason: string;
  handoffAt: string;
  dashboardLink?: string;
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

    // ✅ المهمة 6: WebSocket عبر Gateway
    @Optional()
    private readonly gateway?: AppGateway,

    // ✅ المهمة 6: إشعارات إيميل
    @Optional()
    private readonly mailService?: MailService,
  ) {}

  /**
   * 🔔 عند تحويل محادثة من AI إلى بشري:
   * 1. ✅ emit WebSocket event عبر gateway
   * 2. ✅ يرسل واتساب لكل رقم
   * 3. ✅ يرسل إيميل لكل بريد
   */
  @OnEvent('ai.handoff', { async: true })
  async handleHandoff(event: AIHandoffEvent): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log('🔔 Handoff notification triggered', {
        conversationId: event.conversationId,
        reason: event.reason,
        notifyPhones: event.notifyPhones?.length || 0,
        notifyEmails: event.notifyEmails?.length || 0,
      });

      // ═══════════════════════════════════════════════════════════════════
      // 1️⃣ ✅ المهمة 6: WebSocket event عبر Gateway
      // ═══════════════════════════════════════════════════════════════════
      if (this.gateway) {
        try {
          // تحديث المحادثة في الواجهة (conversation_updated)
          this.gateway.emitConversationUpdate(
            event.tenantId,
            event.conversationId,
            {
              handler: 'human',
              handoffReason: event.reason,
              handoffAt: event.handoffAt,
            },
          );

          // إشعار في الـ dashboard (notification)
          this.gateway.emitNotification(event.tenantId, {
            type: 'warning',
            title: '🔔 تحويل بشري جديد',
            message: `العميل ${event.customerName || 'غير معروف'} يحتاج مساعدة بشرية`,
            data: {
              customer_name: event.customerName || '',
              customer_phone: event.customerPhone || '',
              conversation_id: event.conversationId,
              dashboard_link: event.dashboardLink || `/dashboard/inbox/${event.conversationId}`,
              reason: event.reason,
            },
          });

          this.logger.debug('✅ WebSocket notifications sent');
        } catch (wsError) {
          this.logger.warn('⚠️ WebSocket notification failed', {
            error: wsError instanceof Error ? wsError.message : 'Unknown',
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // 2️⃣ البحث عن القناة لإرسال واتساب
      // ═══════════════════════════════════════════════════════════════════
      let channelId = event.channel;

      if (!channelId) {
        const conv = await this.conversationRepo.findOne({
          where: { id: event.conversationId },
          select: ['id', 'channelId'],
        });

        if (conv?.channelId) {
          channelId = conv.channelId;
        } else {
          this.logger.warn('⚠️ No channel found — cannot send WhatsApp notifications');
        }
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
        `📱 الرقم: ${event.customerPhone || 'غير متوفر'}\n` +
        `📝 السبب: ${reasonText}\n` +
        `⏰ الوقت: ${timeText}\n\n` +
        `💬 يرجى فتح لوحة التحكم للرد على العميل.`;

      // ═══════════════════════════════════════════════════════════════════
      // 4️⃣ ✅ إرسال إشعارات واتساب
      // ═══════════════════════════════════════════════════════════════════
      const phonesToNotify = event.notifyPhones?.filter(p => p?.trim()) || [];

      if (phonesToNotify.length > 0 && channelId) {
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
            this.logger.debug(`✅ WhatsApp sent to ${cleanPhone}`);
          } catch (error) {
            failCount++;
            this.logger.error(`❌ Failed to notify ${phone}`, {
              error: error instanceof Error ? error.message : 'Unknown',
            });
          }
        }

        this.logger.log(`📱 WhatsApp: ${successCount} sent, ${failCount} failed`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // 5️⃣ ✅ المهمة 6: إرسال إشعارات إيميل
      // ═══════════════════════════════════════════════════════════════════
      const emailsToNotify = event.notifyEmails?.filter(e => e?.trim()) || [];

      if (emailsToNotify.length > 0 && this.mailService) {
        let emailSuccess = 0;

        for (const email of emailsToNotify) {
          try {
            await this.mailService.sendMail({
              to: email.trim(),
              subject: `🔔 تحويل بشري جديد — ${event.customerName || 'عميل'}`,
              html: `
                <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
                  <h2 style="color: #6366f1;">🔔 تحويل بشري جديد</h2>
                  <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
                    <tr>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>العميل:</strong></td>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.customerName || 'غير معروف'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>الرقم:</strong></td>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.customerPhone || 'غير متوفر'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>السبب:</strong></td>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;">${reasonText}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>المحادثة:</strong></td>
                      <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.conversationId}</td>
                    </tr>
                  </table>
                  <br/>
                  <a href="${process.env.FRONTEND_URL || 'https://app.rafeq.ai'}/dashboard/inbox/${event.conversationId}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">فتح المحادثة</a>
                </div>
              `,
            });

            emailSuccess++;
            this.logger.debug(`✅ Email sent to ${email}`);
          } catch (error) {
            this.logger.error(`❌ Failed to email ${email}`, {
              error: error instanceof Error ? error.message : 'Unknown',
            });
          }
        }

        this.logger.log(`📧 Email: ${emailSuccess} sent of ${emailsToNotify.length}`);
      }

      this.logger.log(`🔔 Handoff complete`, {
        conversationId: event.conversationId,
        duration: `${Date.now() - startTime}ms`,
      });

    } catch (error) {
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
