/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Telegram Service                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TelegramConnection {
  tenantId: string;
  botToken: string;
  botUsername: string;
  botId: number;
  webhookUrl?: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private connections: Map<string, TelegramConnection> = new Map();

  constructor(private readonly configService: ConfigService) {}

  /**
   * ربط بوت تيليجرام
   */
  async connect(tenantId: string, botToken: string) {
    // Validate bot token by calling getMe
    const botInfo = await this.getMe(botToken);

    if (!botInfo.ok) {
      throw new BadRequestException('Bot Token غير صالح');
    }

    const connection: TelegramConnection = {
      tenantId,
      botToken,
      botUsername: botInfo.result.username,
      botId: botInfo.result.id,
      status: 'active',
      createdAt: new Date(),
    };

    this.connections.set(tenantId, connection);

    this.logger.log(`Telegram bot connected: @${botInfo.result.username}`, { tenantId });

    return {
      success: true,
      message: 'تم ربط البوت بنجاح',
      bot: {
        username: botInfo.result.username,
        firstName: botInfo.result.first_name,
      },
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
        message: 'لم يتم ربط بوت تيليجرام',
      };
    }

    return {
      connected: true,
      bot: {
        username: connection.botUsername,
        id: connection.botId,
      },
      webhookUrl: connection.webhookUrl,
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

    // Delete webhook
    await this.deleteWebhook(connection.botToken);

    this.connections.delete(tenantId);

    this.logger.log(`Telegram bot disconnected`, { tenantId });
  }

  /**
   * إرسال رسالة نصية
   */
  async sendMessage(
    tenantId: string,
    params: {
      chatId: string;
      text: string;
      parseMode?: 'HTML' | 'Markdown';
      replyMarkup?: any;
    },
  ) {
    const connection = this.getConnection(tenantId);

    const body: any = {
      chat_id: params.chatId,
      text: params.text,
    };

    if (params.parseMode) {
      body.parse_mode = params.parseMode;
    }

    if (params.replyMarkup) {
      body.reply_markup = JSON.stringify(params.replyMarkup);
    }

    return this.callApi(connection.botToken, 'sendMessage', body);
  }

  /**
   * إرسال صورة
   */
  async sendPhoto(
    tenantId: string,
    params: {
      chatId: string;
      photo: string;
      caption?: string;
    },
  ) {
    const connection = this.getConnection(tenantId);

    const body: any = {
      chat_id: params.chatId,
      photo: params.photo,
    };

    if (params.caption) {
      body.caption = params.caption;
    }

    return this.callApi(connection.botToken, 'sendPhoto', body);
  }

  /**
   * إرسال ملف
   */
  async sendDocument(
    tenantId: string,
    params: {
      chatId: string;
      document: string;
      caption?: string;
    },
  ) {
    const connection = this.getConnection(tenantId);

    const body: any = {
      chat_id: params.chatId,
      document: params.document,
    };

    if (params.caption) {
      body.caption = params.caption;
    }

    return this.callApi(connection.botToken, 'sendDocument', body);
  }

  /**
   * تعيين Webhook
   */
  async setWebhook(tenantId: string, url: string) {
    const connection = this.getConnection(tenantId);

    const result = await this.callApi(connection.botToken, 'setWebhook', {
      url: `${url}/${connection.botToken}`,
      allowed_updates: ['message', 'callback_query'],
    });

    if (result.ok) {
      connection.webhookUrl = url;
      this.connections.set(tenantId, connection);
    }

    return result;
  }

  /**
   * معالجة التحديثات
   */
  async handleUpdate(token: string, update: any) {
    // Find tenant by token
    const connection = Array.from(this.connections.values())
      .find((c) => c.botToken === token);

    if (!connection) {
      this.logger.warn('Update received for unknown bot', { token: token.substring(0, 10) + '...' });
      return;
    }

    this.logger.log('Telegram update received', {
      tenantId: connection.tenantId,
      updateId: update.update_id,
      type: update.message ? 'message' : update.callback_query ? 'callback' : 'unknown',
    });

    // Process update
    if (update.message) {
      await this.processMessage(connection.tenantId, update.message);
    } else if (update.callback_query) {
      await this.processCallbackQuery(connection.tenantId, update.callback_query);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private getConnection(tenantId: string): TelegramConnection {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      throw new NotFoundException('لم يتم ربط بوت تيليجرام');
    }

    return connection;
  }

  private async getMe(botToken: string) {
    return this.callApi(botToken, 'getMe', {});
  }

  private async deleteWebhook(botToken: string) {
    return this.callApi(botToken, 'deleteWebhook', {});
  }

  private async callApi(botToken: string, method: string, body: any) {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return response.json();
    } catch (error) {
      this.logger.error(`Telegram API error: ${method}`, error);
      throw error;
    }
  }

  private async processMessage(tenantId: string, message: any) {
    // TODO: Create conversation and forward to inbox
    this.logger.log('Processing Telegram message', {
      tenantId,
      chatId: message.chat.id,
      from: message.from?.username,
    });
  }

  private async processCallbackQuery(tenantId: string, query: any) {
    // TODO: Handle callback queries (button clicks)
    this.logger.log('Processing Telegram callback', {
      tenantId,
      data: query.data,
    });
  }
}
