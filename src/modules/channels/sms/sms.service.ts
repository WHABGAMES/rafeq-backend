/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - SMS Service                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SmsConnection {
  tenantId: string;
  provider: string;
  apiKey: string;
  apiSecret?: string;
  senderId: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

interface SendSmsParams {
  to: string;
  message: string;
  senderId?: string;
}

interface BulkSmsParams {
  recipients: string[];
  message: string;
  senderId?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private connections: Map<string, SmsConnection> = new Map();

  constructor(private readonly configService: ConfigService) {}

  /**
   * ربط مزود SMS
   */
  async connect(
    tenantId: string,
    params: {
      provider: string;
      apiKey: string;
      apiSecret?: string;
      senderId: string;
    },
  ) {
    // Validate credentials by making a test call
    const isValid = await this.validateCredentials(params);

    if (!isValid) {
      throw new BadRequestException('بيانات الاعتماد غير صحيحة');
    }

    const connection: SmsConnection = {
      tenantId,
      provider: params.provider,
      apiKey: params.apiKey,
      apiSecret: params.apiSecret,
      senderId: params.senderId,
      status: 'active',
      createdAt: new Date(),
    };

    this.connections.set(tenantId, connection);

    this.logger.log(`SMS provider connected: ${params.provider}`, { tenantId });

    return {
      success: true,
      message: 'تم ربط مزود SMS بنجاح',
      provider: params.provider,
      senderId: params.senderId,
    };
  }

  /**
   * حالة الاتصال
   */
  async getStatus(tenantId: string) {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      return {
        connected: false,
        message: 'لم يتم ربط مزود SMS',
      };
    }

    return {
      connected: true,
      provider: connection.provider,
      senderId: connection.senderId,
      status: connection.status,
      connectedAt: connection.createdAt,
    };
  }

  /**
   * الرصيد
   */
  async getBalance(tenantId: string) {
    const connection = this.getConnection(tenantId);

    // TODO: Call provider API to get balance
    return {
      provider: connection.provider,
      balance: 0,
      currency: 'SAR',
      unit: 'messages',
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

    this.logger.log(`SMS provider disconnected`, { tenantId });
  }

  /**
   * إرسال رسالة
   */
  async send(tenantId: string, params: SendSmsParams) {
    const connection = this.getConnection(tenantId);

    // Normalize phone number
    const phone = this.normalizePhone(params.to);

    // Send via provider
    const result = await this.sendViaProvider(connection, phone, params.message);

    this.logger.log(`SMS sent to ${phone}`, { tenantId, provider: connection.provider });

    return {
      success: true,
      messageId: result.messageId,
      to: phone,
      status: 'sent',
    };
  }

  /**
   * إرسال جماعي
   */
  async sendBulk(tenantId: string, params: BulkSmsParams) {
    const connection = this.getConnection(tenantId);

    const results = [];

    for (const recipient of params.recipients) {
      try {
        const phone = this.normalizePhone(recipient);
        const result = await this.sendViaProvider(connection, phone, params.message);
        results.push({
          to: phone,
          success: true,
          messageId: result.messageId,
        });
      } catch (error) {
        results.push({
          to: recipient,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    this.logger.log(`Bulk SMS sent: ${successCount}/${params.recipients.length}`, { tenantId });

    return {
      total: params.recipients.length,
      success: successCount,
      failed: params.recipients.length - successCount,
      results,
    };
  }

  /**
   * إرسال OTP
   */
  async sendOtp(
    tenantId: string,
    params: {
      to: string;
      code?: string;
      template?: string;
    },
  ) {
    const code = params.code || this.generateOtp();
    const message = params.template
      ? params.template.replace('{{code}}', code)
      : `رمز التحقق الخاص بك هو: ${code}`;

    const result = await this.send(tenantId, {
      to: params.to,
      message,
    });

    return {
      ...result,
      code, // Return code for verification (in production, store securely)
      expiresIn: 300, // 5 minutes
    };
  }

  /**
   * تقارير الإرسال
   */
  async getReports(
    tenantId: string,
    params: {
      from?: string;
      to?: string;
      page: number;
      limit: number;
    },
  ) {
    // TODO: Fetch from database
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
        failed: 0,
        pending: 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private getConnection(tenantId: string): SmsConnection {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      throw new NotFoundException('لم يتم ربط مزود SMS');
    }

    return connection;
  }

  private async validateCredentials(params: {
    provider: string;
    apiKey: string;
    apiSecret?: string;
  }): Promise<boolean> {
    // TODO: Implement actual validation for each provider
    return true;
  }

  private async sendViaProvider(
    connection: SmsConnection,
    phone: string,
    message: string,
  ): Promise<{ messageId: string }> {
    // TODO: Implement actual sending for each provider
    switch (connection.provider) {
      case 'unifonic':
        return this.sendViaUnifonic(connection, phone, message);
      case 'twilio':
        return this.sendViaTwilio(connection, phone, message);
      case 'taqnyat':
        return this.sendViaTaqnyat(connection, phone, message);
      default:
        throw new BadRequestException(`مزود غير مدعوم: ${connection.provider}`);
    }
  }

  private async sendViaUnifonic(
    connection: SmsConnection,
    phone: string,
    message: string,
  ): Promise<{ messageId: string }> {
    // TODO: Implement Unifonic API call
    return { messageId: `unifonic-${Date.now()}` };
  }

  private async sendViaTwilio(
    connection: SmsConnection,
    phone: string,
    message: string,
  ): Promise<{ messageId: string }> {
    // TODO: Implement Twilio API call
    return { messageId: `twilio-${Date.now()}` };
  }

  private async sendViaTaqnyat(
    connection: SmsConnection,
    phone: string,
    message: string,
  ): Promise<{ messageId: string }> {
    // TODO: Implement Taqnyat API call
    return { messageId: `taqnyat-${Date.now()}` };
  }

  private normalizePhone(phone: string): string {
    // Remove all non-digits
    let normalized = phone.replace(/\D/g, '');

    // Add Saudi country code if not present
    if (normalized.startsWith('05')) {
      normalized = '966' + normalized.substring(1);
    } else if (normalized.startsWith('5')) {
      normalized = '966' + normalized;
    } else if (!normalized.startsWith('966') && !normalized.startsWith('+')) {
      normalized = '966' + normalized;
    }

    return normalized;
  }

  private generateOtp(length = 6): string {
    return Math.random()
      .toString()
      .substring(2, 2 + length);
  }
}
