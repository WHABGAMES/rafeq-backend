/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - SMS Service                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

interface SmsConnection {
  tenantId: string;
  provider: string;
  apiKey: string;
  apiSecret?: string;
  senderId: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private connections: Map<string, SmsConnection> = new Map();

  /**
   * ✅ ربط مزود SMS - متوافق مع Controller
   * Controller يرسل: { provider, apiKey, apiSecret?, senderId }
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
   * ✅ الرصيد - مطلوب من Controller
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
   * ✅ إرسال رسالة - متوافق مع Controller
   * Controller يرسل: { to, message, senderId? }
   */
  async send(
    tenantId: string,
    params: {
      to: string;
      message: string;
      senderId?: string;
    },
  ) {
    const connection = this.getConnection(tenantId);

    // Normalize phone number
    const phone = this.normalizePhone(params.to);

    // Send via provider
    const result = await this.sendViaProvider(
      connection,
      phone,
      params.message,
      params.senderId || connection.senderId,
    );

    this.logger.log(`SMS sent to ${phone}`, { tenantId, provider: connection.provider });

    return {
      success: true,
      messageId: result.messageId,
      to: phone,
      status: 'sent',
    };
  }

  /**
   * ✅ إرسال جماعي - متوافق مع Controller
   * Controller يرسل: { recipients: string[], message, senderId? }
   */
  async sendBulk(
    tenantId: string,
    params: {
      recipients: string[];
      message: string;
      senderId?: string;
    },
  ) {
    const connection = this.getConnection(tenantId);

    const results = [];

    for (const recipient of params.recipients) {
      try {
        const phone = this.normalizePhone(recipient);
        const result = await this.sendViaProvider(
          connection,
          phone,
          params.message,
          params.senderId || connection.senderId,
        );
        results.push({
          to: phone,
          success: true,
          messageId: result.messageId,
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          to: recipient,
          success: false,
          error: errorMessage,
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
   * ✅ إرسال OTP - مطلوب من Controller
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
      code, // Return code for verification
      expiresIn: 300, // 5 minutes
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

  private async sendViaProvider(
    connection: SmsConnection,
    _phone: string,
    _message: string,
    _senderId: string,
  ): Promise<{ messageId: string }> {
    // TODO: Implement actual sending for each provider
    switch (connection.provider) {
      case 'unifonic':
        return { messageId: `unifonic-${Date.now()}` };
      case 'twilio':
        return { messageId: `twilio-${Date.now()}` };
      case 'taqnyat':
        return { messageId: `taqnyat-${Date.now()}` };
      default:
        return { messageId: `sms-${Date.now()}` };
    }
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
