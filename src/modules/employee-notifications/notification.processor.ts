/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Notification Queue Processor                         ║
 * ║                                                                                ║
 * ║  معالج الـ Queue: إرسال التنبيهات عبر القنوات المختلفة                        ║
 * ║  Dashboard (فوري) | Email (SMTP) | WhatsApp (Baileys)                          ║
 * ║                                                                                ║
 * ║  ✅ v2: ربط فعلي مع MailService و WhatsAppBaileysService                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeNotificationsService } from './employee-notifications.service';
import { NotificationChannel } from './entities/notification-rule.entity';
import { NotificationStatus } from './entities/employee-notification.entity';

// ✅ خدمات الإرسال الفعلية
import { MailService } from '../mail/mail.service';
import { WhatsAppBaileysService } from '../channels/whatsapp/whatsapp-baileys.service';
import { Channel, ChannelStatus } from '../channels/entities/channel.entity';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface NotificationJobData {
  notificationId: string;
  channel: NotificationChannel;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  employeePhone: string | null;
  title: string;
  message: string;
  actionUrl: string | null;
  priority: number;
  tenantId?: string;
}

// ═══════════════════════════════════════════════════════════
// Processor
// ═══════════════════════════════════════════════════════════

@Processor('employee-notifications')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notificationsService: EmployeeNotificationsService,
    private readonly mailService: MailService,
    private readonly whatsAppBaileysService: WhatsAppBaileysService,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { data } = job;

    this.logger.log(
      `🔔 Processing notification: ${data.notificationId} via ${data.channel} → ${data.employeeName}`,
    );

    try {
      switch (data.channel) {
        case NotificationChannel.DASHBOARD:
          await this.sendDashboardNotification(data);
          break;

        case NotificationChannel.EMAIL:
          await this.sendEmailNotification(data);
          break;

        case NotificationChannel.WHATSAPP:
          await this.sendWhatsAppNotification(data);
          break;

        default:
          this.logger.warn(`Unknown channel: ${data.channel}`);
      }

      // تحديث الحالة إلى "مُرسل" (فقط للقنوات الخارجية — Dashboard يكون DELIVERED مباشرة)
      if (data.channel !== NotificationChannel.DASHBOARD) {
        await this.notificationsService.updateNotificationStatus(
          data.notificationId,
          NotificationStatus.SENT,
        );
      }

      this.logger.log(
        `✅ Notification sent: ${data.notificationId} → ${data.channel} → ${data.employeeName}`,
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `❌ Failed to send notification: ${data.notificationId}`,
        { error: errorMessage, channel: data.channel },
      );

      // تحديث الحالة إلى "فشل"
      await this.notificationsService.updateNotificationStatus(
        data.notificationId,
        NotificationStatus.FAILED,
        errorMessage,
      );

      throw error; // BullMQ سيعيد المحاولة تلقائياً
    }
  }

  // ═══════════════════════════════════════════════════════════
  // قنوات الإرسال
  // ═══════════════════════════════════════════════════════════

  /**
   * إشعار داخلي (Dashboard)
   * يتم حفظه في قاعدة البيانات فقط — الواجهة تقرأه
   */
  private async sendDashboardNotification(data: NotificationJobData): Promise<void> {
    this.logger.log(
      `📋 Dashboard notification ready: ${data.title} → ${data.employeeName}`,
    );

    // TODO: إرسال عبر WebSocket للتحديث الفوري
    // this.gateway.sendToUser(data.employeeId, { type: 'notification', ... });
  }

  /**
   * ✅ إرسال بريد إلكتروني فعلي عبر MailService
   */
  private async sendEmailNotification(data: NotificationJobData): Promise<void> {
    if (!data.employeeEmail || !data.employeeEmail.includes('@')) {
      this.logger.warn(`⏭️ Skipping email — no valid email for: ${data.employeeName}`);
      await this.notificationsService.updateNotificationStatus(
        data.notificationId,
        NotificationStatus.FAILED,
      );
      return; // لا ترمي خطأ — لا حاجة لإعادة المحاولة
    }

    const emailHtml = this.buildEmailHtml(data);

    this.logger.log(`📧 Sending email to ${data.employeeEmail}: ${data.title}`);

    const sent = await this.mailService.sendMail({
      to: data.employeeEmail,
      subject: `🔔 ${data.title}`,
      html: emailHtml,
    });

    if (!sent) {
      throw new Error(`Failed to send email to ${data.employeeEmail}`);
    }

    this.logger.log(`✅ Email sent to ${data.employeeEmail}`);
  }

  /**
   * ✅ إرسال رسالة واتساب فعلية عبر WhatsAppBaileysService
   */
  private async sendWhatsAppNotification(data: NotificationJobData): Promise<void> {
    if (!data.employeePhone || data.employeePhone.trim().length < 5) {
      this.logger.warn(`⏭️ Skipping WhatsApp — no valid phone for: ${data.employeeName}`);
      await this.notificationsService.updateNotificationStatus(
        data.notificationId,
        NotificationStatus.FAILED,
      );
      return; // لا ترمي خطأ — لا حاجة لإعادة المحاولة
    }

    // البحث عن قناة واتساب متصلة
    const channel = await this.channelRepository.findOne({
      where: { status: ChannelStatus.CONNECTED },
      order: { createdAt: 'DESC' },
    });

    if (!channel) {
      throw new Error('No connected WhatsApp channel found');
    }

    // تنظيف الرقم
    const phone = data.employeePhone.replace(/[^0-9]/g, '');

    this.logger.log(`📱 Sending WhatsApp to ${phone} via channel ${channel.id}`);

    // بناء الرسالة — الترتيب: نص الرسالة → الرابط → فريق رفيق يقولك (آخر شي)
    let whatsappMessage = `🔔 *${data.title}*\n\n`;

    // فصل نص الرسالة عن فقرة "فريق رفيق يقولك"
    const parts = data.message.split('\n\nفريق رفيق يقولك:');
    const mainText = parts[0];
    const motivationalPart = parts[1] ? `\nفريق رفيق يقولك:${parts[1]}` : '';

    whatsappMessage += mainText;

    // فريق رفيق يقولك آخر شي
    whatsappMessage += `\n${motivationalPart}`;

    await this.whatsAppBaileysService.sendTextMessage(
      channel.id,
      phone,
      whatsappMessage,
    );

    this.logger.log(`✅ WhatsApp sent to ${phone}`);
  }

  /**
   * بناء HTML للبريد الإلكتروني
   */
  private buildEmailHtml(data: NotificationJobData): string {
    const safeTitle = this.escapeHtml(data.title);
    const safeActionUrl = data.actionUrl ? this.escapeHtml(data.actionUrl) : null;

    // فصل الرسالة الأساسية عن الفقرة التحفيزية
    const parts = data.message.split('\n\n—\n\n');
    const mainMessage = this.escapeHtml(parts[0] || '');
    const motivationalPart = parts[1] || '';

    // استخراج النص التحفيزي بعد "فريق رفيق يقولك:"
    let motivationalLabel = '';
    let motivationalText = '';
    if (motivationalPart.includes('فريق رفيق يقولك:')) {
      const motParts = motivationalPart.split('فريق رفيق يقولك:');
      motivationalLabel = 'فريق رفيق يقولك:';
      motivationalText = this.escapeHtml((motParts[1] || '').trim());
    }

    return `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; direction: rtl; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 24px; text-align: center; }
          .header h1 { margin: 0; font-size: 20px; }
          .body { padding: 24px; color: #333; line-height: 1.8; }
          .action-btn { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 16px; }
          .motivational { margin-top: 24px; padding: 16px 20px; background: linear-gradient(135deg, #fef9f0, #fdf6ec); border-radius: 8px; border-right: 4px solid #f59e0b; text-align: center; }
          .motivational-label { font-size: 13px; color: #92400e; font-weight: 600; margin: 0 0 6px; }
          .motivational-text { font-size: 15px; color: #78350f; margin: 0; line-height: 1.8; }
          .footer { padding: 16px 24px; background: #f9fafb; color: #6b7280; font-size: 12px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${safeTitle}</h1>
          </div>
          <div class="body">
            <p>${mainMessage.replace(/\n/g, '<br>')}</p>
            ${safeActionUrl ? `<a href="${safeActionUrl}" class="action-btn">عرض التفاصيل</a>` : ''}
            ${motivationalText ? `
            <div class="motivational">
              <p class="motivational-label">🌟 ${this.escapeHtml(motivationalLabel)}</p>
              <p class="motivational-text">${motivationalText}</p>
            </div>
            ` : ''}
          </div>
          <div class="footer">
            <p>هذا تنبيه تلقائي من منصة رفيق — لا تحتاج للرد على هذا البريد</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * تنظيف HTML لمنع XSS
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
