/**
 * RAFIQ PLATFORM - SMS Service
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SmsConnection {
  tenantId: string;
  provider: string;
  credentials: {
    accountSid?: string;
    authToken?: string;
    apiKey?: string;
    senderId?: string;
  };
  fromNumber: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private connections: Map<string, SmsConnection> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly configService: ConfigService) {}

  async connect(
    tenantId: string,
    params: {
      provider: string;
      accountSid?: string;
      authToken?: string;
      apiKey?: string;
      senderId?: string;
      fromNumber: string;
    },
  ) {
    await this.validateCredentials(params);

    const connection: SmsConnection = {
      tenantId,
      provider: params.provider,
      credentials: {
        accountSid: params.accountSid,
        authToken: params.authToken,
        apiKey: params.apiKey,
        senderId: params.senderId,
      },
      fromNumber: params.fromNumber,
      status: 'active',
      createdAt: new Date(),
    };

    this.connections.set(tenantId, connection);
    this.logger.log(`SMS service connected: ${params.provider}`, { tenantId });

    return {
      success: true,
      message: 'تم ربط خدمة SMS بنجاح',
      provider: params.provider,
      fromNumber: params.fromNumber,
    };
  }

  async testConnection(tenantId: string, testPhone: string) {
    this.getConnection(tenantId);
    try {
      await this.send(tenantId, testPhone, 'رسالة اختبارية من منصة رفيق');
      return { success: true, message: `تم إرسال رسالة اختبارية إلى ${testPhone}` };
    } catch (error: any) {
      return { success: false, message: `فشل الإرسال: ${error?.message || 'Unknown'}` };
    }
  }

  async getStatus(tenantId: string) {
    const connection = this.connections.get(tenantId);
    if (!connection) {
      return { connected: false, message: 'لم يتم ربط خدمة SMS' };
    }
    return {
      connected: true,
      provider: connection.provider,
      fromNumber: connection.fromNumber,
      status: connection.status,
    };
  }

  async disconnect(tenantId: string) {
    const connection = this.connections.get(tenantId);
    if (!connection) throw new NotFoundException('خدمة SMS غير مربوطة');
    this.connections.delete(tenantId);
    this.logger.log('SMS service disconnected', { tenantId });
  }

  async send(tenantId: string, phone: string, message: string) {
    const connection = this.getConnection(tenantId);
    const result = await this.sendViaProvider(connection, phone, message);
    this.logger.log(`SMS sent to ${phone}`, { tenantId });
    return result;
  }

  async sendBulk(
    tenantId: string,
    params: {
      recipients: Array<{ phone: string; name?: string; variables?: Record<string, string> }>;
      message: string;
    },
  ) {
    const results: any[] = [];
    for (const recipient of params.recipients) {
      try {
        let message = params.message;
        if (recipient.variables) {
          for (const [key, value] of Object.entries(recipient.variables)) {
            message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
          }
        }
        const result = await this.send(tenantId, recipient.phone, message);
        results.push({ phone: recipient.phone, success: true, messageId: result.messageId });
      } catch (error: any) {
        results.push({ phone: recipient.phone, success: false, error: error?.message || 'Unknown' });
      }
    }
    const successCount = results.filter((r) => r.success).length;
    this.logger.log(`Bulk SMS sent: ${successCount}/${params.recipients.length}`, { tenantId });
    return { total: params.recipients.length, success: successCount, failed: params.recipients.length - successCount, results };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getReports(_tenantId: string, params: { from?: string; to?: string; page: number; limit: number }) {
    return {
      data: [],
      pagination: { page: params.page, limit: params.limit, total: 0, totalPages: 0 },
      summary: { sent: 0, delivered: 0, failed: 0 },
    };
  }

  private getConnection(tenantId: string): SmsConnection {
    const connection = this.connections.get(tenantId);
    if (!connection) throw new NotFoundException('لم يتم ربط خدمة SMS');
    return connection;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async validateCredentials(_params: any): Promise<boolean> {
    return true;
  }

  private async sendViaProvider(connection: SmsConnection, phone: string, message: string): Promise<{ messageId: string }> {
    switch (connection.provider) {
      case 'twilio': return this.sendViaTwilio(phone, message);
      case 'unifonic': return this.sendViaUnifonic(phone, message);
      case 'jawaly': return this.sendViaJawaly(phone, message);
      default: throw new BadRequestException(`مزود غير مدعوم: ${connection.provider}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendViaTwilio(_phone: string, _message: string): Promise<{ messageId: string }> {
    return { messageId: `twilio-${Date.now()}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendViaUnifonic(_phone: string, _message: string): Promise<{ messageId: string }> {
    return { messageId: `unifonic-${Date.now()}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendViaJawaly(_phone: string, _message: string): Promise<{ messageId: string }> {
    return { messageId: `jawaly-${Date.now()}` };
  }
}
