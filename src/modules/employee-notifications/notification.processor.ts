/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Notification Queue Processor                         ║
 * ║                                                                                ║
 * ║  معالج الـ Queue: إرسال التنبيهات عبر القنوات المختلفة                        ║
 * ║  Dashboard (فوري) | Email (SMTP) | WhatsApp (API)                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmployeeNotificationsService } from './employee-notifications.service';
import { NotificationChannel } from './entities/notification-rule.entity';
import { NotificationStatus } from './entities/employee-notification.entity';

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
}

// ═══════════════════════════════════════════════════════════
// Processor
// ═══════════════════════════════════════════════════════════

@Processor('employee-notifications')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notificationsService: EmployeeNotificationsService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { data } = job;

    this.logger.debug(
      `Processing notification: ${data.notificationId} via ${data.channel}`,
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

      // تحديث الحالة إلى "مُرسل"
      await this.notificationsService.updateNotificationStatus(
        data.notificationId,
        NotificationStatus.SENT,
      );

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
    // الإشعار الداخلي يكون محفوظ بالفعل في DB بحالة DELIVERED
    // هنا يمكن إضافة WebSocket/SSE push إذا كان متاحاً
    
    this.logger.debug(
      `📋 Dashboard notification ready: ${data.title} → ${data.employeeName}`,
    );

    // TODO: إرسال عبر WebSocket للتحديث الفوري
    // this.gateway.sendToUser(data.employeeId, {
    //   type: 'notification',
    //   title: data.title,
    //   message: data.message,
    //   actionUrl: data.actionUrl,
    // });
  }

  /**
   * إرسال بريد إلكتروني
   */
  private async sendEmailNotification(data: NotificationJobData): Promise<void> {
    if (!data.employeeEmail) {
      this.logger.warn(`No email for employee: ${data.employeeName}`);
      throw new Error('Employee email not available');
    }

    // تجهيز HTML للبريد
    const emailHtml = this.buildEmailHtml(data);

    // TODO: استخدام خدمة البريد الموجودة (مثل MailerService أو SendGrid)
    // await this.mailerService.sendMail({
    //   to: data.employeeEmail,
    //   subject: data.title,
    //   html: emailHtml,
    // });

    this.logger.debug(
      `📧 Email notification → ${data.employeeEmail}: ${data.title} (${emailHtml.length} chars)`,
    );
  }

  /**
   * إرسال رسالة واتساب
   */
  private async sendWhatsAppNotification(data: NotificationJobData): Promise<void> {
    if (!data.employeePhone) {
      this.logger.warn(`No phone for employee: ${data.employeeName}`);
      throw new Error('Employee phone not available');
    }

    // TODO: استخدام خدمة الواتساب الموجودة
    // await this.whatsappService.sendMessage({
    //   to: data.employeePhone,
    //   message: data.message,
    // });

    this.logger.debug(
      `📱 WhatsApp notification → ${data.employeePhone}: ${data.message.substring(0, 50)}...`,
    );
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
