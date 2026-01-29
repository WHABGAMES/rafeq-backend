/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Email Service                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

interface EmailConnection {
  tenantId: string;
  provider: string;
  config: Record<string, unknown>;
  fromEmail: string;
  fromName: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

/**
 * ✅ SendEmailParams - متوافق مع Controller
 * يدعم to كـ string أو string[]
 */
export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  variables?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: string;
    encoding?: string;
  }>;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private connections: Map<string, EmailConnection> = new Map();

  /**
   * ربط خدمة البريد
   */
  async connect(
    tenantId: string,
    params: {
      provider: string;
      host?: string;
      port?: number;
      secure?: boolean;
      username?: string;
      password?: string;
      apiKey?: string;
      domain?: string;
      fromEmail: string;
      fromName: string;
    },
  ) {
    const connection: EmailConnection = {
      tenantId,
      provider: params.provider,
      config: {
        host: params.host,
        port: params.port,
        secure: params.secure,
        username: params.username,
        password: params.password,
        apiKey: params.apiKey,
        domain: params.domain,
      },
      fromEmail: params.fromEmail,
      fromName: params.fromName,
      status: 'active',
      createdAt: new Date(),
    };

    this.connections.set(tenantId, connection);

    this.logger.log(`Email provider connected: ${params.provider}`, { tenantId });

    return {
      success: true,
      message: 'تم ربط خدمة البريد بنجاح',
      provider: params.provider,
      fromEmail: params.fromEmail,
    };
  }

  /**
   * اختبار الاتصال
   */
  async testConnection(tenantId: string, testEmail: string) {
    this.getConnection(tenantId);

    try {
      await this.send(tenantId, {
        to: testEmail,
        subject: 'اختبار اتصال رفيق',
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>تم الاتصال بنجاح! 🎉</h2>
            <p>هذا بريد اختباري للتأكد من صحة إعدادات البريد في منصة رفيق.</p>
          </div>
        `,
        text: 'تم الاتصال بنجاح! هذا بريد اختباري.',
      });

      return {
        success: true,
        message: `تم إرسال بريد اختباري إلى ${testEmail}`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `فشل إرسال البريد: ${errorMessage}`,
      };
    }
  }

  /**
   * حالة الاتصال
   */
  async getStatus(tenantId: string) {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      return {
        connected: false,
        message: 'لم يتم ربط خدمة البريد',
      };
    }

    return {
      connected: true,
      provider: connection.provider,
      fromEmail: connection.fromEmail,
      fromName: connection.fromName,
      status: connection.status,
      connectedAt: connection.createdAt,
    };
  }

  /**
   * فصل الاتصال
   */
  async disconnect(tenantId: string) {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      throw new NotFoundException('لم يتم العثور على اتصال');
    }

    this.connections.delete(tenantId);

    this.logger.log(`Email provider disconnected`, { tenantId });
  }

  /**
   * ✅ إرسال بريد - يقبل to كـ string أو string[]
   */
  async send(tenantId: string, params: SendEmailParams) {
    const connection = this.getConnection(tenantId);

    // تحويل to إلى array للمعالجة الموحدة
    const recipients = Array.isArray(params.to) ? params.to : [params.to];

    // Process template if provided
    let html = params.html;
    let text = params.text;

    if (params.templateId && params.variables) {
      const template = await this.getTemplateById(params.templateId);
      html = this.processTemplate(template.html, params.variables);
      text = this.processTemplate(template.text, params.variables);
    }

    // Send via provider
    const result = await this.sendViaProvider(connection, {
      to: recipients,
      subject: params.subject,
      html,
      text,
      cc: params.cc,
      bcc: params.bcc,
      replyTo: params.replyTo,
      attachments: params.attachments,
    });

    this.logger.log(`Email sent`, {
      tenantId,
      to: recipients,
      subject: params.subject,
    });

    return {
      success: true,
      messageId: result.messageId,
      to: params.to,
      status: 'sent',
    };
  }

  /**
   * إرسال جماعي
   */
  async sendBulk(
    tenantId: string,
    params: {
      recipients: Array<{
        email: string;
        name?: string;
        variables?: Record<string, string>;
      }>;
      subject: string;
      html?: string;
      text?: string;
      templateId?: string;
    },
  ) {
    const results = [];

    for (const recipient of params.recipients) {
      try {
        const html = params.html
          ? this.processTemplate(params.html, recipient.variables || {})
          : undefined;
        const text = params.text
          ? this.processTemplate(params.text, recipient.variables || {})
          : undefined;

        const result = await this.send(tenantId, {
          to: recipient.email,
          subject: this.processTemplate(params.subject, recipient.variables || {}),
          html,
          text,
          templateId: params.templateId,
          variables: recipient.variables,
        });

        results.push({
          email: recipient.email,
          success: true,
          messageId: result.messageId,
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          email: recipient.email,
          success: false,
          error: errorMessage,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    this.logger.log(`Bulk email sent: ${successCount}/${params.recipients.length}`, { tenantId });

    return {
      total: params.recipients.length,
      success: successCount,
      failed: params.recipients.length - successCount,
      results,
    };
  }

  /**
   * قوالب البريد
   */
  async getTemplates(_tenantId: string) {
    return {
      templates: [
        {
          id: 'order_confirmation',
          name: 'تأكيد الطلب',
          subject: 'تأكيد طلبك رقم #{{order_id}}',
          category: 'orders',
        },
        {
          id: 'shipping_notification',
          name: 'إشعار الشحن',
          subject: 'تم شحن طلبك #{{order_id}}',
          category: 'orders',
        },
        {
          id: 'welcome',
          name: 'ترحيب',
          subject: 'مرحباً بك في {{store_name}}',
          category: 'customers',
        },
        {
          id: 'password_reset',
          name: 'استعادة كلمة المرور',
          subject: 'إعادة تعيين كلمة المرور',
          category: 'auth',
        },
        {
          id: 'review_request',
          name: 'طلب تقييم',
          subject: 'شاركنا رأيك في {{product_name}}',
          category: 'marketing',
        },
      ],
    };
  }

  /**
   * تقارير الإرسال
   */
  async getReports(
    _tenantId: string,
    params: {
      from?: string;
      to?: string;
      page: number;
      limit: number;
    },
  ) {
    return {
      data: [],
      pagination: {
        page: params.page,
        limit: params.limit,
        total: 0,
        totalPages: 0,
      },
      summary: {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private getConnection(tenantId: string): EmailConnection {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      throw new NotFoundException('لم يتم ربط خدمة البريد');
    }

    return connection;
  }

  private async sendViaProvider(
    connection: EmailConnection,
    _params: {
      to: string[];
      subject: string;
      html?: string;
      text?: string;
      cc?: string[];
      bcc?: string[];
      replyTo?: string;
      attachments?: Array<{ filename: string; content: string; encoding?: string }>;
    },
  ): Promise<{ messageId: string }> {
    // TODO: Implement actual sending based on provider
    switch (connection.provider) {
      case 'smtp':
        return { messageId: `smtp-${Date.now()}` };
      case 'sendgrid':
        return { messageId: `sendgrid-${Date.now()}` };
      case 'mailgun':
        return { messageId: `mailgun-${Date.now()}` };
      case 'ses':
        return { messageId: `ses-${Date.now()}` };
      default:
        return { messageId: `email-${Date.now()}` };
    }
  }

  private async getTemplateById(_templateId: string) {
    return {
      html: '<p>Template content</p>',
      text: 'Template content',
    };
  }

  private processTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return result;
  }
}
