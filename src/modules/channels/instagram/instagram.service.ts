/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Instagram Messaging Service                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface InstagramConnection {
  tenantId: string;
  accessToken: string;
  pageId: string;
  instagramAccountId: string;
  username: string;
  status: 'active' | 'inactive';
  createdAt: Date;
}

export interface InstagramSendResponse {
  recipient_id: string;
  message_id: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private connections: Map<string, InstagramConnection> = new Map();

  private readonly API_VERSION = 'v18.0';
  private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  constructor(private readonly configService: ConfigService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // OAuth & Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * الحصول على رابط OAuth
   */
  async getAuthUrl(tenantId: string): Promise<string> {
    const clientId = this.configService.get('INSTAGRAM_CLIENT_ID');
    const redirectUri = this.configService.get('INSTAGRAM_REDIRECT_URI');
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64');

    return `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user_profile,user_media&response_type=code&state=${state}`;
  }

  /**
   * معالجة OAuth Callback
   */
  async handleCallback(_code: string, state: string): Promise<{ username: string }> {
    const { tenantId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Exchange code for token (simplified)
    const accessToken = `ig_token_${Date.now()}`;
    const username = 'instagram_user';

    const connection: InstagramConnection = {
      tenantId,
      accessToken,
      pageId: `page_${Date.now()}`,
      instagramAccountId: `ig_${Date.now()}`,
      username,
      status: 'active',
      createdAt: new Date(),
    };

    this.connections.set(tenantId, connection);

    this.logger.log(`Instagram connected: @${username}`, { tenantId });

    return { username };
  }

  /**
   * حالة الاتصال
   */
  async getConnectionStatus(tenantId: string) {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      return {
        connected: false,
        message: 'لم يتم ربط Instagram',
      };
    }

    return {
      connected: true,
      username: connection.username,
      instagramAccountId: connection.instagramAccountId,
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

    this.logger.log(`Instagram disconnected`, { tenantId });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Messaging
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إرسال رسالة مباشرة
   */
  async sendDirectMessage(
    tenantId: string,
    recipientId: string,
    message: string,
    _mediaUrl?: string,
  ): Promise<InstagramSendResponse> {
    const connection = this.getConnection(tenantId);

    const payload = {
      recipient: { id: recipientId },
      message: { text: message },
    };

    return this.sendMessage(connection.pageId, payload, connection.accessToken);
  }

  /**
   * إرسال رسالة نصية
   */
  async sendTextMessage(
    pageId: string,
    recipientId: string,
    text: string,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    const payload = {
      recipient: { id: recipientId },
      message: { text },
    };

    return this.sendMessage(pageId, payload, accessToken);
  }

  /**
   * إرسال صورة
   */
  async sendImageMessage(
    pageId: string,
    recipientId: string,
    imageUrl: string,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    const payload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: 'image',
          payload: {
            url: imageUrl,
            is_reusable: true,
          },
        },
      },
    };

    return this.sendMessage(pageId, payload, accessToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Webhook
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من Webhook
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | number {
    const verifyToken = this.configService.get('INSTAGRAM_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Instagram webhook verified');
      return challenge;
    }

    throw new BadRequestException('Webhook verification failed');
  }

  /**
   * معالجة Webhook
   */
  async handleWebhook(body: unknown): Promise<void> {
    const payload = body as {
      object?: string;
      entry?: Array<{
        id: string;
        messaging?: Array<unknown>;
      }>;
    };

    if (payload.object !== 'instagram') {
      return;
    }

    for (const entry of payload.entry || []) {
      for (const messaging of entry.messaging || []) {
        await this.processWebhookMessage(entry.id, messaging);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private getConnection(tenantId: string): InstagramConnection {
    const connection = this.connections.get(tenantId);

    if (!connection) {
      throw new NotFoundException('لم يتم ربط Instagram');
    }

    return connection;
  }

  private async sendMessage(
    pageId: string,
    payload: Record<string, unknown>,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    const url = `${this.BASE_URL}/${pageId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as InstagramSendResponse;

      this.logger.log('Instagram message sent', { messageId: data.message_id });

      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to send Instagram message', { error: errorMessage });
      throw new BadRequestException('Failed to send Instagram message');
    }
  }

  private async processWebhookMessage(instagramAccountId: string, messaging: unknown): Promise<void> {
    this.logger.log('Processing Instagram webhook message', { instagramAccountId, messaging });
    // TODO: Process incoming messages
  }
}
