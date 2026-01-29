/**
 * RAFIQ PLATFORM - Telegram Service
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

interface TelegramApiResponse<T = any> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private connections: Map<string, TelegramConnection> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly configService: ConfigService) {}

  async connect(tenantId: string, botToken: string) {
    const botInfo = await this.getMe(botToken);
    if (!botInfo.ok || !botInfo.result) {
      throw new BadRequestException('Bot Token غير صالح');
    }

    const connection: TelegramConnection = {
      tenantId,
      botToken,
      botUsername: botInfo.result.username || '',
      botId: botInfo.result.id,
      status: 'active',
      createdAt: new Date(),
    };

    this.connections.set(tenantId, connection);
    this.logger.log(`Telegram bot connected: @${botInfo.result.username}`, { tenantId });

    return {
      success: true,
      message: 'تم ربط البوت بنجاح',
      bot: { username: botInfo.result.username, firstName: botInfo.result.first_name },
    };
  }

  async getStatus(tenantId: string) {
    const connection = this.connections.get(tenantId);
    if (!connection) {
      return { connected: false, message: 'لم يتم ربط بوت تيليجرام' };
    }
    return {
      connected: true,
      botUsername: connection.botUsername,
      webhookUrl: connection.webhookUrl,
      status: connection.status,
    };
  }

  async disconnect(tenantId: string) {
    const connection = this.connections.get(tenantId);
    if (!connection) throw new NotFoundException('البوت غير مربوط');
    this.connections.delete(tenantId);
    this.logger.log('Telegram bot disconnected', { tenantId });
  }

  async sendMessage(tenantId: string, chatId: string | number, text: string) {
    const connection = this.getConnection(tenantId);
    return this.callApi(connection.botToken, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  }

  async sendPhoto(tenantId: string, chatId: string | number, photo: string, caption?: string) {
    const connection = this.getConnection(tenantId);
    return this.callApi(connection.botToken, 'sendPhoto', { chat_id: chatId, photo, caption });
  }

  async sendDocument(tenantId: string, chatId: string | number, document: string, caption?: string) {
    const connection = this.getConnection(tenantId);
    return this.callApi(connection.botToken, 'sendDocument', { chat_id: chatId, document, caption });
  }

  async setWebhook(tenantId: string, url: string) {
    const connection = this.getConnection(tenantId);
    const result = await this.callApi(connection.botToken, 'setWebhook', {
      url: `${url}/${connection.botToken}`,
      allowed_updates: ['message', 'callback_query'],
    }) as TelegramApiResponse;

    if (result.ok) {
      connection.webhookUrl = url;
      this.connections.set(tenantId, connection);
    }
    return result;
  }

  async handleUpdate(token: string, update: any) {
    const connection = Array.from(this.connections.values()).find((c) => c.botToken === token);
    if (!connection) {
      this.logger.warn('Update received for unknown bot');
      return;
    }

    this.logger.log('Telegram update received', {
      tenantId: connection.tenantId,
      updateId: update.update_id,
      type: update.message ? 'message' : update.callback_query ? 'callback' : 'unknown',
    });

    if (update.message) await this.processMessage(connection.tenantId, update.message);
    else if (update.callback_query) await this.processCallbackQuery(connection.tenantId, update.callback_query);
  }

  private getConnection(tenantId: string): TelegramConnection {
    const connection = this.connections.get(tenantId);
    if (!connection) throw new NotFoundException('البوت غير مربوط');
    return connection;
  }

  private async getMe(botToken: string): Promise<TelegramApiResponse<TelegramUser>> {
    return this.callApi(botToken, 'getMe', {}) as Promise<TelegramApiResponse<TelegramUser>>;
  }

  private async callApi(botToken: string, method: string, body: any): Promise<unknown> {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.json();
    } catch (error: any) {
      this.logger.error(`Telegram API error: ${method}`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async processMessage(_tenantId: string, message: any) {
    this.logger.log('Processing Telegram message', { chatId: message.chat.id, from: message.from?.username });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async processCallbackQuery(_tenantId: string, query: any) {
    this.logger.log('Processing Telegram callback', { data: query.data });
  }
}
