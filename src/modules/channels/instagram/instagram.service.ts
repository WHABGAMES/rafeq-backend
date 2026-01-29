/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Instagram Messaging Service                      ║
 * ║                                                                                ║
 * ║  📌 خدمة الرسائل المباشرة في Instagram                                          ║
 * ║                                                                                ║
 * ║  تستخدم Instagram Graph API (Messenger Platform)                              ║
 * ║                                                                                ║
 * ║  المتطلبات:                                                                    ║
 * ║  - Facebook Business Page مرتبطة بحساب Instagram Professional                 ║
 * ║  - Instagram Professional Account (Business أو Creator)                       ║
 * ║  - Facebook App مع Instagram Basic Display API                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * أنواع رسائل Instagram
 */
export enum InstagramMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
  SHARE = 'share',       // مشاركة منشور
  STORY_MENTION = 'story_mention',
  STORY_REPLY = 'story_reply',
  REACTION = 'reaction',
}

/**
 * حالة الرسالة
 */
export enum InstagramMessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}

/**
 * بيانات الـ Webhook من Instagram
 */
export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: Array<{
    id: string;          // Instagram Business Account ID
    time: number;
    messaging?: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text?: string;
        attachments?: Array<{
          type: 'image' | 'video' | 'audio' | 'file' | 'share' | 'story_mention';
          payload: {
            url?: string;
            sticker_id?: number;
            reel_video_id?: string;
            title?: string;
          };
        }>;
        reply_to?: {
          mid: string;
        };
        quick_reply?: {
          payload: string;
        };
        is_echo?: boolean;
        is_deleted?: boolean;
      };
      reaction?: {
        mid: string;
        action: 'react' | 'unreact';
        reaction?: string;  // emoji
        emoji?: string;
      };
      read?: {
        mid: string;
        watermark: number;
      };
      postback?: {
        mid: string;
        title: string;
        payload: string;
      };
    }>;
  }>;
}

/**
 * استجابة إرسال الرسالة
 */
export interface InstagramSendResponse {
  recipient_id: string;
  message_id: string;
}

/**
 * معلومات المستخدم
 */
export interface InstagramUserProfile {
  id: string;
  username?: string;
  name?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  /**
   * 📌 Instagram Graph API
   * 
   * Instagram يستخدم نفس منصة Messenger
   * الـ API هو graph.facebook.com
   */
  private readonly API_VERSION = 'v18.0';
  private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📤 SENDING MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إرسال رسالة نصية
   * 
   * @param pageId معرف الصفحة المرتبطة بـ Instagram
   * @param recipientId معرف المستلم (IGSID)
   * @param text نص الرسالة
   * @param accessToken توكن الصفحة
   * 
   * 📌 ملاحظة مهمة:
   * - يمكن الإرسال فقط للمستخدمين الذين راسلوا الحساب
   * - هناك نافذة 24 ساعة (مثل WhatsApp)
   * - لا يمكن بدء محادثة من الصفر
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
            is_reusable: true,  // يمكن إعادة استخدام الصورة
          },
        },
      },
    };

    return this.sendMessage(pageId, payload, accessToken);
  }

  /**
   * إرسال فيديو
   */
  async sendVideoMessage(
    pageId: string,
    recipientId: string,
    videoUrl: string,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    const payload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: 'video',
          payload: {
            url: videoUrl,
            is_reusable: true,
          },
        },
      },
    };

    return this.sendMessage(pageId, payload, accessToken);
  }

  /**
   * إرسال رسالة بأزرار سريعة (Quick Replies)
   * 
   * 📌 Quick Replies:
   * - أزرار تظهر أسفل الرسالة
   * - تختفي بعد الضغط عليها
   * - حد أقصى 13 زر
   */
  async sendQuickReplyMessage(
    pageId: string,
    recipientId: string,
    text: string,
    quickReplies: Array<{
      title: string;      // النص (حد أقصى 20 حرف)
      payload: string;    // القيمة المرجعة
      imageUrl?: string;  // أيقونة (اختياري)
    }>,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    // التحقق من عدد الأزرار
    if (quickReplies.length > 13) {
      throw new BadRequestException('Quick replies cannot exceed 13');
    }

    const payload = {
      recipient: { id: recipientId },
      message: {
        text,
        quick_replies: quickReplies.map((qr) => ({
          content_type: 'text',
          title: qr.title.substring(0, 20), // قص إذا تجاوز
          payload: qr.payload,
          ...(qr.imageUrl && { image_url: qr.imageUrl }),
        })),
      },
    };

    return this.sendMessage(pageId, payload, accessToken);
  }

  /**
   * إرسال Generic Template
   * 
   * 📌 Generic Template:
   * - بطاقات (Cards) مع صورة وعنوان وأزرار
   * - يمكن التمرير بينها (Carousel)
   * - مثالي لعرض المنتجات
   */
  async sendGenericTemplate(
    pageId: string,
    recipientId: string,
    elements: Array<{
      title: string;
      subtitle?: string;
      imageUrl?: string;
      defaultActionUrl?: string;
      buttons?: Array<{
        type: 'web_url' | 'postback';
        title: string;
        url?: string;      // لـ web_url
        payload?: string;  // لـ postback
      }>;
    }>,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    // التحقق من عدد العناصر (حد أقصى 10)
    if (elements.length > 10) {
      throw new BadRequestException('Generic template cannot exceed 10 elements');
    }

    const payload = {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: elements.map((el) => ({
              title: el.title.substring(0, 80),
              subtitle: el.subtitle?.substring(0, 80),
              image_url: el.imageUrl,
              default_action: el.defaultActionUrl
                ? {
                    type: 'web_url',
                    url: el.defaultActionUrl,
                  }
                : undefined,
              buttons: el.buttons?.map((btn) => ({
                type: btn.type,
                title: btn.title.substring(0, 20),
                ...(btn.type === 'web_url' && { url: btn.url }),
                ...(btn.type === 'postback' && { payload: btn.payload }),
              })),
            })),
          },
        },
      },
    };

    return this.sendMessage(pageId, payload, accessToken);
  }

  /**
   * إرسال Ice Breakers
   * 
   * 📌 Ice Breakers:
   * - أزرار تظهر عند بداية المحادثة
   * - تساعد المستخدم على البدء
   * - مثل: "كيف أطلب؟", "أين متجركم؟"
   */
  async setIceBreakers(
    pageId: string,
    iceBreakers: Array<{
      question: string;   // النص الظاهر
      payload: string;    // القيمة المرجعة
    }>,
    accessToken: string,
  ): Promise<void> {
    const url = `${this.BASE_URL}/${pageId}/messenger_profile`;

    const payload = {
      platform: 'instagram',
      ice_breakers: iceBreakers.map((ib) => ({
        question: ib.question,
        payload: ib.payload,
      })),
    };

    try {
      await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      this.logger.log('Ice breakers set successfully', { pageId });
    } catch (error) {
      this.logger.error('Failed to set ice breakers', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to set ice breakers');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📥 WEBHOOK HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من الـ Webhook
   */
  verifyWebhook(
    mode: string,
    token: string,
    challenge: string,
  ): string | null {
    const verifyToken = this.configService.get<string>('instagram.webhookVerifyToken');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Instagram webhook verified');
      return challenge;
    }

    return null;
  }

  /**
   * معالجة Webhook
   */
  async processWebhook(
    payload: InstagramWebhookPayload,
    channelId: string,
  ): Promise<void> {
    this.logger.debug('Processing Instagram webhook', {
      entries: payload.entry?.length,
    });

    for (const entry of payload.entry || []) {
      for (const messaging of entry.messaging || []) {
        // تجاهل الـ Echo (رسائلنا نحن)
        if (messaging.message?.is_echo) {
          continue;
        }

        // تجاهل الرسائل المحذوفة
        if (messaging.message?.is_deleted) {
          continue;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 📬 رسالة جديدة
        // ─────────────────────────────────────────────────────────────────────────
        if (messaging.message) {
          await this.handleIncomingMessage(channelId, entry.id, messaging);
        }

        // ─────────────────────────────────────────────────────────────────────────
        // ❤️ Reaction
        // ─────────────────────────────────────────────────────────────────────────
        if (messaging.reaction) {
          await this.handleReaction(channelId, messaging);
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 👁️ Read Receipt
        // ─────────────────────────────────────────────────────────────────────────
        if (messaging.read) {
          await this.handleReadReceipt(channelId, messaging);
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 🔘 Postback (زر تم الضغط عليه)
        // ─────────────────────────────────────────────────────────────────────────
        if (messaging.postback) {
          await this.handlePostback(channelId, messaging);
        }
      }
    }
  }

  /**
   * معالجة رسالة واردة
   */
  private async handleIncomingMessage(
    channelId: string,
    instagramAccountId: string,
    messaging: NonNullable<InstagramWebhookPayload['entry'][0]['messaging']>[0],
  ): Promise<void> {
    const message = messaging.message!;
    const senderId = messaging.sender.id;

    this.logger.log(`Incoming Instagram message from ${senderId}`, {
      messageId: message.mid,
    });

    // استخراج المحتوى
    let content = '';
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;
    let quickReplyPayload: string | undefined;

    // نص
    if (message.text) {
      content = message.text;
    }

    // Quick Reply
    if (message.quick_reply) {
      quickReplyPayload = message.quick_reply.payload;
      content = content || quickReplyPayload;
    }

    // مرفقات
    if (message.attachments && message.attachments.length > 0) {
      const attachment = message.attachments[0];
      mediaType = attachment.type;
      mediaUrl = attachment.payload.url;

      switch (attachment.type) {
        case 'image':
          content = '[صورة]';
          break;
        case 'video':
          content = '[فيديو]';
          break;
        case 'audio':
          content = '[رسالة صوتية]';
          break;
        case 'file':
          content = '[ملف]';
          break;
        case 'share':
          content = attachment.payload.title || '[مشاركة]';
          break;
        case 'story_mention':
          content = '[إشارة في Story]';
          break;
      }
    }

    // إطلاق Event
    this.eventEmitter.emit('channel.message.received', {
      channel: 'instagram',
      channelId,
      externalMessageId: message.mid,
      from: senderId,
      instagramAccountId,
      content,
      type: mediaType || 'text',
      mediaUrl,
      quickReplyPayload,
      replyTo: message.reply_to?.mid,
      timestamp: new Date(messaging.timestamp),
      raw: messaging,
    });
  }

  /**
   * معالجة Reaction
   */
  private async handleReaction(
    channelId: string,
    messaging: NonNullable<InstagramWebhookPayload['entry'][0]['messaging']>[0],
  ): Promise<void> {
    const reaction = messaging.reaction!;

    this.eventEmitter.emit('channel.message.reaction', {
      channel: 'instagram',
      channelId,
      messageId: reaction.mid,
      from: messaging.sender.id,
      action: reaction.action,
      emoji: reaction.reaction || reaction.emoji,
      timestamp: new Date(messaging.timestamp),
    });
  }

  /**
   * معالجة Read Receipt
   */
  private async handleReadReceipt(
    channelId: string,
    messaging: NonNullable<InstagramWebhookPayload['entry'][0]['messaging']>[0],
  ): Promise<void> {
    const read = messaging.read!;

    this.eventEmitter.emit('channel.message.status', {
      channel: 'instagram',
      channelId,
      externalMessageId: read.mid,
      status: InstagramMessageStatus.READ,
      timestamp: new Date(read.watermark),
    });
  }

  /**
   * معالجة Postback
   */
  private async handlePostback(
    channelId: string,
    messaging: NonNullable<InstagramWebhookPayload['entry'][0]['messaging']>[0],
  ): Promise<void> {
    const postback = messaging.postback!;

    this.eventEmitter.emit('channel.message.received', {
      channel: 'instagram',
      channelId,
      externalMessageId: postback.mid,
      from: messaging.sender.id,
      content: postback.title,
      type: 'postback',
      postbackPayload: postback.payload,
      timestamp: new Date(messaging.timestamp),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 USER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب معلومات المستخدم
   * 
   * 📌 ملاحظة:
   * - يمكن جلب معلومات فقط للمستخدمين الذين راسلونا
   * - بعض الحقول قد تكون فارغة حسب إعدادات الخصوصية
   */
  async getUserProfile(
    userId: string,
    accessToken: string,
  ): Promise<InstagramUserProfile> {
    const fields = [
      'id',
      'username',
      'name',
      'profile_pic',
      'follower_count',
      'is_user_follow_business',
      'is_business_follow_user',
    ].join(',');

    const url = `${this.BASE_URL}/${userId}?fields=${fields}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get user profile', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to get user profile');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 INSIGHTS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب إحصائيات المحادثات
   */
  async getConversationInsights(
    _instagramAccountId: string,
    _accessToken: string,
    _since?: Date,
    _until?: Date,
  ): Promise<{
    totalConversations: number;
    openConversations: number;
    averageResponseTime: number;
  }> {
    // TODO: تنفيذ باستخدام Instagram Insights API
    // الـ API يوفر metrics مثل:
    // - impressions
    // - reach
    // - profile_views
    // لكن insights للـ messages محدودة

    return {
      totalConversations: 0,
      openConversations: 0,
      averageResponseTime: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إرسال رسالة (الطريقة الأساسية)
   */
  private async sendMessage(
    pageId: string,
    payload: Record<string, unknown>,
    accessToken: string,
  ): Promise<InstagramSendResponse> {
    // Instagram يستخدم نفس endpoint الـ Messenger
    const url = `${this.BASE_URL}/${pageId}/messages`;

    try {
      const response = await firstValueFrom(
        this.httpService.post<InstagramSendResponse>(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log('Instagram message sent', {
        messageId: response.data.message_id,
      });

      return response.data;
    } catch (error: any) {
      const errorData = error?.response?.data?.error;
      
      this.logger.error('Failed to send Instagram message', {
        error: errorData || error.message,
      });

      if (errorData) {
        throw new BadRequestException(
          `Instagram Error: ${errorData.message} (Code: ${errorData.code})`,
        );
      }

      throw new BadRequestException('Failed to send Instagram message');
    }
  }

  /**
   * التحقق من توقيع الـ Webhook
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const crypto = require('crypto');
    const appSecret = this.configService.get<string>('instagram.appSecret');

    if (!appSecret) {
      return true; // في التطوير
    }

    const [algorithm, hash] = signature.split('=');

    if (algorithm !== 'sha256' || !hash) {
      return false;
    }

    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(expectedHash),
    );
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📚 ملاحظات Instagram API:
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 1. الفرق عن WhatsApp:
 *    - لا يمكن بدء محادثة (العميل يجب أن يبدأ)
 *    - نافذة 24 ساعة بعد آخر رسالة من العميل
 *    - لا Templates كما في WhatsApp
 * 
 * 2. Rate Limits:
 *    - 200 API calls / hour / Instagram account
 *    - الـ Sends لها limits منفصلة
 * 
 * 3. Permissions المطلوبة:
 *    - instagram_basic
 *    - instagram_manage_messages
 *    - pages_manage_metadata
 *    - pages_messaging
 * 
 * 4. Story Mentions:
 *    - يمكنك الرد على من أشار إليك في Story
 *    - فرصة للتفاعل مع العملاء
 * 
 * 5. Private Replies:
 *    - يمكنك الرد على التعليقات برسالة خاصة
 *    - مفيد للشكاوى العلنية
 * 
 * 6. قيود:
 *    - لا يمكن إرسال رسائل ترويجية
 *    - يجب أن تكون الرسائل ردود على استفسارات
 *    - Meta قد تراجع وتحظر الحسابات المخالفة
 */
