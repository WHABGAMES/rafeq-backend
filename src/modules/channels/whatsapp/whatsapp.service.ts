/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Business API Service                    ║
 * ║                                                                                ║
 * ║  📌 هذه الخدمة تتعامل مع WhatsApp Business API (Cloud API)                      ║
 * ║                                                                                ║
 * ║  المسؤوليات:                                                                   ║
 * ║  1. إرسال رسائل (نص، صور، ملفات، أزرار)                                        ║
 * ║  2. استقبال ومعالجة الـ Webhooks                                               ║
 * ║  3. إدارة Templates                                                           ║
 * ║  4. تتبع حالة الرسائل                                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { getHttpErrorDetails } from '@common/utils/error.util';
import { asJsonRecord, getJsonString } from '@common/utils/json-record.util';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES - تعريف الأنواع
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 📱 WhatsApp Message Types
 * 
 * WhatsApp يدعم أنواع متعددة من الرسائل:
 * - text: نص عادي
 * - image: صورة
 * - document: ملف (PDF, Word, etc.)
 * - audio: صوت
 * - video: فيديو
 * - template: رسالة قالب (للتسويق والتنبيهات)
 * - interactive: أزرار وقوائم
 * - location: موقع
 * - contacts: جهات اتصال
 * - sticker: ملصق
 * - reaction: رد فعل على رسالة
 */
export enum WhatsAppMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  DOCUMENT = 'document',
  AUDIO = 'audio',
  VIDEO = 'video',
  TEMPLATE = 'template',
  INTERACTIVE = 'interactive',
  LOCATION = 'location',
  CONTACTS = 'contacts',
  STICKER = 'sticker',
  REACTION = 'reaction',
}

/**
 * 📊 حالة الرسالة
 * 
 * WhatsApp يرسل webhooks لتتبع حالة كل رسالة:
 * - sent: الرسالة وصلت لخوادم WhatsApp
 * - delivered: الرسالة وصلت لجهاز المستلم
 * - read: المستلم قرأ الرسالة (إذا كان Blue Tick مفعل)
 * - failed: فشل الإرسال
 */
export enum WhatsAppMessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}

/**
 * 📝 بنية رسالة نصية
 */
export interface WhatsAppTextMessage {
  type: WhatsAppMessageType.TEXT;
  text: {
    body: string;          // نص الرسالة (حد أقصى 4096 حرف)
    preview_url?: boolean; // هل نعرض معاينة للروابط؟
  };
}

/**
 * 🖼️ بنية رسالة صورة
 */
export interface WhatsAppImageMessage {
  type: WhatsAppMessageType.IMAGE;
  image: {
    link?: string;    // رابط الصورة (يجب أن يكون HTTPS)
    id?: string;      // أو Media ID من WhatsApp
    caption?: string; // وصف الصورة (اختياري)
  };
}

/**
 * 📄 بنية رسالة مستند
 */
export interface WhatsAppDocumentMessage {
  type: WhatsAppMessageType.DOCUMENT;
  document: {
    link?: string;
    id?: string;
    caption?: string;
    filename?: string; // اسم الملف
  };
}

/**
 * 📋 بنية رسالة Template
 * 
 * Templates مهمة لأن:
 * 1. مطلوبة لبدء محادثة مع عميل لأول مرة
 * 2. مطلوبة للرسائل التسويقية
 * 3. يجب الموافقة عليها من Meta مسبقاً
 */
export interface WhatsAppTemplateMessage {
  type: WhatsAppMessageType.TEMPLATE;
  template: {
    name: string;       // اسم القالب
    language: {
      code: string;     // مثل: ar, en
    };
    components?: Array<{
      type: 'header' | 'body' | 'button';
      parameters: Array<{
        type: 'text' | 'image' | 'document' | 'video';
        text?: string;
        image?: { link: string };
        document?: { link: string };
      }>;
    }>;
  };
}

/**
 * 🔘 بنية رسالة تفاعلية (أزرار/قائمة)
 */
export interface WhatsAppInteractiveMessage {
  type: WhatsAppMessageType.INTERACTIVE;
  interactive: {
    type: 'button' | 'list' | 'product' | 'product_list';
    header?: {
      type: 'text' | 'image' | 'video' | 'document';
      text?: string;
      image?: { link: string };
    };
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: WhatsAppButtonAction | WhatsAppListAction;
  };
}

/**
 * أزرار الرسالة التفاعلية
 * حد أقصى 3 أزرار
 */
export interface WhatsAppButtonAction {
  buttons: Array<{
    type: 'reply';
    reply: {
      id: string;     // معرف فريد للزر
      title: string;  // النص (حد أقصى 20 حرف)
    };
  }>;
}

/**
 * قائمة الرسالة التفاعلية
 */
export interface WhatsAppListAction {
  button: string;  // نص زر القائمة
  sections: Array<{
    title?: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

/**
 * نوع الرسالة الموحد
 */
export type WhatsAppMessage =
  | WhatsAppTextMessage
  | WhatsAppImageMessage
  | WhatsAppDocumentMessage
  | WhatsAppTemplateMessage
  | WhatsAppInteractiveMessage;

/**
 * 📬 بنية Webhook من WhatsApp
 */
export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; caption?: string; mime_type: string };
          document?: { id: string; filename: string; mime_type: string };
          audio?: { id: string; mime_type: string };
          video?: { id: string; caption?: string; mime_type: string };
          interactive?: {
            type: 'button_reply' | 'list_reply';
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string; description?: string };
          };
          context?: {
            from: string;
            id: string;
          };
        }>;
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
          errors?: Array<{
            code: number;
            title: string;
            message: string;
          }>;
        }>;
      };
      field: 'messages';
    }>;
  }>;
}

/**
 * استجابة إرسال الرسالة
 */
export interface WhatsAppSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 SERVICE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  /**
   * 📌 WhatsApp Cloud API URLs
   * 
   * Meta تستضيف الـ API على graph.facebook.com
   * الإصدار الحالي: v21.0
   */
  private readonly API_VERSION = 'v21.0';
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
   * @param phoneNumberId معرف رقم WhatsApp Business
   * @param to رقم المستلم (مع رمز الدولة، بدون +)
   * @param text نص الرسالة
   * @param accessToken توكن الوصول
   * 
   * @example
   * await sendTextMessage('12345', '966501234567', 'مرحباً!', 'token');
   */
  async sendTextMessage(
    phoneNumberId: string,
    to: string,
    text: string,
    accessToken: string,
  ): Promise<WhatsAppSendResponse> {
    // ─────────────────────────────────────────────────────────────────────────────
    // 📌 تنسيق رقم الهاتف
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * WhatsApp يتطلب الرقم بصيغة:
     * - بدون + في البداية
     * - بدون مسافات أو شرطات
     * - مع رمز الدولة
     * 
     * مثال: 966501234567 (سعودي)
     */
    const formattedPhone = this.formatPhoneNumber(to);

    // ─────────────────────────────────────────────────────────────────────────────
    // 📌 بناء الـ Payload
    // ─────────────────────────────────────────────────────────────────────────────
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: {
        preview_url: true,  // معاينة الروابط
        body: text,
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  /**
   * إرسال صورة
   * 
   * @param phoneNumberId معرف رقم WhatsApp Business
   * @param to رقم المستلم
   * @param imageUrl رابط الصورة (يجب HTTPS)
   * @param caption وصف الصورة (اختياري)
   * @param accessToken توكن الوصول
   */
  async sendImageMessage(
    phoneNumberId: string,
    to: string,
    imageUrl: string,
    caption: string | undefined,
    accessToken: string,
  ): Promise<WhatsAppSendResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'image',
      image: {
        link: imageUrl,
        ...(caption && { caption }),
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  /**
   * إرسال مستند (PDF, Word, etc.)
   */
  async sendDocumentMessage(
    phoneNumberId: string,
    to: string,
    documentUrl: string,
    filename: string,
    caption: string | undefined,
    accessToken: string,
  ): Promise<WhatsAppSendResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'document',
      document: {
        link: documentUrl,
        filename,
        ...(caption && { caption }),
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  /**
   * إرسال رسالة Template
   * 
   * 📌 ملاحظة مهمة:
   * - Templates مطلوبة لبدء محادثة جديدة
   * - يجب إنشاء الـ Template في Meta Business Suite
   * - يجب انتظار الموافقة من Meta
   * - Templates مدفوعة (عكس الرسائل العادية)
   * 
   * @param templateName اسم القالب كما هو في Meta
   * @param languageCode رمز اللغة (ar, en)
   * @param components المتغيرات في القالب
   */
  async sendTemplateMessage(
    phoneNumberId: string,
    to: string,
    templateName: string,
    languageCode: string,
    components: WhatsAppTemplateMessage['template']['components'],
    accessToken: string,
  ): Promise<WhatsAppSendResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        ...(components && { components }),
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  /**
   * إرسال رسالة بأزرار
   * 
   * 📌 قيود الأزرار:
   * - حد أقصى 3 أزرار
   * - نص الزر حد أقصى 20 حرف
   * - لا يمكن إرسالها كأول رسالة (يجب Template أولاً)
   */
  async sendButtonMessage(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    accessToken: string,
    headerText?: string,
    footerText?: string,
  ): Promise<WhatsAppSendResponse> {
    // التحقق من عدد الأزرار
    if (buttons.length > 3) {
      throw new BadRequestException('WhatsApp يدعم حد أقصى 3 أزرار');
    }

    // التحقق من طول نص الأزرار
    for (const button of buttons) {
      if (button.title.length > 20) {
        throw new BadRequestException(`نص الزر "${button.title}" يتجاوز 20 حرف`);
      }
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(headerText && {
          header: {
            type: 'text',
            text: headerText,
          },
        }),
        body: {
          text: bodyText,
        },
        ...(footerText && {
          footer: {
            text: footerText,
          },
        }),
        action: {
          buttons: buttons.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title,
            },
          })),
        },
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  /**
   * إرسال قائمة خيارات
   * 
   * 📌 قيود القائمة:
   * - حد أقصى 10 أقسام
   * - كل قسم حد أقصى 10 عناصر
   * - إجمالي العناصر حد أقصى 10
   */
  async sendListMessage(
    phoneNumberId: string,
    to: string,
    bodyText: string,
    buttonText: string,
    sections: Array<{
      title?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
    accessToken: string,
    headerText?: string,
    footerText?: string,
  ): Promise<WhatsAppSendResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(headerText && {
          header: {
            type: 'text',
            text: headerText,
          },
        }),
        body: {
          text: bodyText,
        },
        ...(footerText && {
          footer: {
            text: footerText,
          },
        }),
        action: {
          button: buttonText,
          sections,
        },
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  /**
   * إرسال رد فعل على رسالة
   * 
   * 📌 ملاحظة:
   * - يمكن إرسال أي emoji
   * - لإزالة الرد: أرسل emoji فارغ ""
   */
  async sendReaction(
    phoneNumberId: string,
    to: string,
    messageId: string,
    emoji: string,
    accessToken: string,
  ): Promise<WhatsAppSendResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'reaction',
      reaction: {
        message_id: messageId,
        emoji,
      },
    };

    return this.sendMessage(phoneNumberId, payload, accessToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📥 WEBHOOK HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من صحة الـ Webhook (للاشتراك الأولي)
   * 
   * 📌 عند إعداد Webhook في Meta:
   * 1. Meta ترسل GET request مع challenge
   * 2. نتحقق من الـ verify_token
   * 3. نرجع الـ challenge
   */
  verifyWebhook(
    mode: string,
    token: string,
    challenge: string,
  ): string | null {
    const verifyToken = this.configService.get<string>('whatsapp.webhookVerifyToken');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified successfully');
      return challenge;
    }

    this.logger.warn('WhatsApp webhook verification failed');
    return null;
  }

  /**
   * معالجة Webhook
   * 
   * 📌 أنواع الـ Webhooks:
   * 1. messages: رسائل جديدة من العملاء
   * 2. statuses: تحديثات حالة الرسائل (sent, delivered, read)
   */
  async processWebhook(
    payload: WhatsAppWebhookPayload,
    channelId: string,
  ): Promise<void> {
    this.logger.debug('Processing WhatsApp webhook', {
      entries: payload.entry?.length,
    });

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // ─────────────────────────────────────────────────────────────────────────
        // 📬 معالجة الرسائل الواردة
        // ─────────────────────────────────────────────────────────────────────────
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            const contact = value.contacts?.find(
              (c) => c.wa_id === message.from,
            );

            await this.handleIncomingMessage(
              channelId,
              message,
              contact,
              value.metadata,
            );
          }
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 📊 معالجة تحديثات الحالة
        // ─────────────────────────────────────────────────────────────────────────
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            await this.handleStatusUpdate(channelId, status);
          }
        }
      }
    }
  }

  /**
   * معالجة رسالة واردة
   */
  private async handleIncomingMessage(
    channelId: string,
    message: NonNullable<WhatsAppWebhookPayload['entry'][0]['changes'][0]['value']['messages']>[0],
    contact: { profile: { name: string }; wa_id: string } | undefined,
    _metadata: { display_phone_number: string; phone_number_id: string },
  ): Promise<void> {
    this.logger.log(`Incoming WhatsApp message from ${message.from}`, {
      type: message.type,
      messageId: message.id,
    });

    // استخراج محتوى الرسالة حسب النوع
    let content = '';
    let mediaId: string | undefined;
    let mediaType: string | undefined;
    let interactiveReply: { type: string; id: string; title: string } | undefined;

    switch (message.type) {
      case 'text':
        content = message.text?.body || '';
        break;

      case 'image':
        mediaId = message.image?.id;
        mediaType = 'image';
        content = message.image?.caption || '[صورة]';
        break;

      case 'document':
        mediaId = message.document?.id;
        mediaType = 'document';
        content = `[مستند: ${message.document?.filename}]`;
        break;

      case 'audio':
        mediaId = message.audio?.id;
        mediaType = 'audio';
        content = '[رسالة صوتية]';
        break;

      case 'video':
        mediaId = message.video?.id;
        mediaType = 'video';
        content = message.video?.caption || '[فيديو]';
        break;

      case 'interactive':
        if (message.interactive?.button_reply) {
          interactiveReply = {
            type: 'button',
            id: message.interactive.button_reply.id,
            title: message.interactive.button_reply.title,
          };
          content = message.interactive.button_reply.title;
        } else if (message.interactive?.list_reply) {
          interactiveReply = {
            type: 'list',
            id: message.interactive.list_reply.id,
            title: message.interactive.list_reply.title,
          };
          content = message.interactive.list_reply.title;
        }
        break;

      default:
        content = `[${message.type}]`;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 🎯 إطلاق Event للتعامل مع الرسالة
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * نستخدم EventEmitter لـ:
     * 1. فصل المسؤوليات (Separation of Concerns)
     * 2. السماح لعدة خدمات بالاستماع للرسائل
     * 3. معالجة غير متزامنة
     */
    this.eventEmitter.emit('channel.message.received', {
      channel: 'whatsapp',
      channelId,
      externalMessageId: message.id,
      from: message.from,
      customerName: contact?.profile?.name,
      content,
      type: message.type,
      mediaId,
      mediaType,
      interactiveReply,
      replyTo: message.context?.id,
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      raw: message,
    });
  }

  /**
   * معالجة تحديث حالة الرسالة
   */
  private async handleStatusUpdate(
    channelId: string,
    status: NonNullable<WhatsAppWebhookPayload['entry'][0]['changes'][0]['value']['statuses']>[0],
  ): Promise<void> {
    this.logger.debug(`Message status update: ${status.id} -> ${status.status}`);

    // تحويل حالة WhatsApp لحالتنا
    let messageStatus: WhatsAppMessageStatus;
    switch (status.status) {
      case 'sent':
        messageStatus = WhatsAppMessageStatus.SENT;
        break;
      case 'delivered':
        messageStatus = WhatsAppMessageStatus.DELIVERED;
        break;
      case 'read':
        messageStatus = WhatsAppMessageStatus.READ;
        break;
      case 'failed':
        messageStatus = WhatsAppMessageStatus.FAILED;
        break;
      default:
        return;
    }

    // إطلاق Event
    this.eventEmitter.emit('channel.message.status', {
      channel: 'whatsapp',
      channelId,
      externalMessageId: status.id,
      status: messageStatus,
      timestamp: new Date(parseInt(status.timestamp) * 1000),
      errors: status.errors,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📎 MEDIA HANDLING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تحميل Media من WhatsApp
   * 
   * 📌 خطوات تحميل الوسائط:
   * 1. أولاً: الحصول على URL من الـ media_id
   * 2. ثانياً: تحميل الملف من URL
   */
  async downloadMedia(
    mediaId: string,
    accessToken: string,
  ): Promise<{ url: string; mimeType: string; sha256: string; fileSize: number }> {
    // الخطوة 1: الحصول على URL
    const mediaUrl = `${this.BASE_URL}/${mediaId}`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(mediaUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      return {
        url: response.data.url,
        mimeType: response.data.mime_type,
        sha256: response.data.sha256,
        fileSize: response.data.file_size,
      };
    } catch (error) {
      this.logger.error('Failed to get media URL', {
        mediaId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to get media URL');
    }
  }

  /**
   * رفع Media إلى WhatsApp
   * 
   * 📌 أنواع الملفات المدعومة:
   * - Images: image/jpeg, image/png (max 5MB)
   * - Documents: application/pdf, etc. (max 100MB)
   * - Audio: audio/aac, audio/mp4, etc. (max 16MB)
   * - Video: video/mp4, video/3gp (max 16MB)
   * - Stickers: image/webp (max 100KB)
   */
  async uploadMedia(
    phoneNumberId: string,
    file: Buffer,
    mimeType: string,
    filename: string,
    accessToken: string,
  ): Promise<string> {
    const uploadUrl = `${this.BASE_URL}/${phoneNumberId}/media`;

    try {
      // إنشاء FormData
      const form = new FormData();
      form.append('file', file, {
        filename,
        contentType: mimeType,
      });
      form.append('type', mimeType);
      form.append('messaging_product', 'whatsapp');

      const response = await firstValueFrom(
        this.httpService.post(uploadUrl, form, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...form.getHeaders(),
          },
        }),
      );

      this.logger.log('Media uploaded successfully', {
        mediaId: response.data.id,
      });

      return response.data.id;
    } catch (error) {
      this.logger.error('Failed to upload media', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to upload media');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إرسال رسالة (الطريقة الأساسية)
   */
  private async sendMessage(
    phoneNumberId: string,
    payload: Record<string, unknown>,
    accessToken: string,
  ): Promise<WhatsAppSendResponse> {
    const url = `${this.BASE_URL}/${phoneNumberId}/messages`;

    try {
      const response = await firstValueFrom(
        this.httpService.post<WhatsAppSendResponse>(url, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log('Message sent successfully', {
        messageId: response.data.messages[0]?.id,
        to: payload.to,
      });

      return response.data;
    } catch (error: unknown) {
      const details = getHttpErrorDetails(error, 'Failed to send WhatsApp message');
      this.logger.error('Failed to send WhatsApp message', {
        error: details,
        payload: { ...payload, to: '***' }, // إخفاء الرقم في اللوج
      });

      // استخراج رسالة الخطأ من WhatsApp
      const response = asJsonRecord(asJsonRecord(error)?.response);
      const responseData = asJsonRecord(response?.data);
      const whatsappError = asJsonRecord(responseData?.error);
      const whatsappMessage = getJsonString(whatsappError, 'message');
      const whatsappCode = whatsappError?.code;
      if (whatsappMessage) {
        throw new BadRequestException(
          `WhatsApp Error: ${whatsappMessage} (Code: ${String(whatsappCode ?? 'unknown')})`,
        );
      }

      throw new BadRequestException('Failed to send WhatsApp message');
    }
  }

  /**
   * ✅ FIX-5: تنسيق رقم الهاتف لجميع الدول
   *
   * القاعدة الذهبية: إذا كان الرقم مع رمز الدولة → استخدمه مباشرة.
   * الحالة الوحيدة التي نُضيف فيها رمز الدولة = الأرقام السعودية القصيرة (9 أرقام تبدأ بـ 5).
   * لجميع الدول الأخرى: نطلب الرقم كاملاً مع رمز الدولة.
   *
   * أمثلة:
   *   +966501234567  → 966501234567  ✅
   *   00966501234567 → 966501234567  ✅
   *   966501234567   → 966501234567  ✅ (مع رمز الدولة)
   * FIX: formatPhoneNumber معالجة دولية صحيحة
   *
   * القاعدة الأساسية: لا نفترض رمز دولة إلا في حالات محددة وواضحة
   * يُتوقع من المستخدم/النظام تمرير أرقام مع رمز الدولة دائماً
   *
   * ما نفعله:
   *   - +966501234567  → 966501234567  (إزالة +)
   *   - 00966501234567 → 966501234567  (إزالة 00)
   *   - 0501234567     → 966501234567  (سعودي محلي — 10 أرقام تبدأ بـ 05)
   *   - 501234567      → 966501234567  (سعودي بدون صفر — 9 أرقام تبدأ بـ 5)
   *   - 971501234567   → 971501234567  (إماراتي — رمز دولة موجود)
   *   - 967701234567   → 967701234567  (يمني — رمز دولة موجود)
   *   - 201234567890   → 201234567890  (مصري — رمز دولة موجود)
   *
   * أي رقم لا ينطبق عليه ما سبق يُترك كما هو بعد إزالة الرموز غير الرقمية
   */
  private formatPhoneNumber(phone: string): string {
    // إزالة كل شيء غير الأرقام (بما في ذلك + والمسافات والشرطات)
    let cleaned = phone.replace(/\D/g, '');

    // حالة 1: 00XXXXXXXXX → XXXXXXXXX (إزالة 00 الدولية)
    if (cleaned.startsWith('00') && cleaned.length > 10) {
      cleaned = cleaned.slice(2);
    }

    // حالة 2: أرقام سعودية محلية — 05XXXXXXXX (10 أرقام)
    if (cleaned.startsWith('05') && cleaned.length === 10) {
      cleaned = '966' + cleaned.slice(1);
      return cleaned;
    }

    // حالة 3: أرقام سعودية بدون صفر — 5XXXXXXXX (9 أرقام)
    if (cleaned.startsWith('5') && cleaned.length === 9) {
      cleaned = '966' + cleaned;
      return cleaned;
    }

    // باقي الأرقام: يجب أن تحتوي رمز الدولة — نُرجعها كما هي
    // النظام يتوقع أن المُرسِل يُمرِّر أرقاماً مع رمز الدولة
    return cleaned;
  }

  /**
   * التحقق من صحة رقم الهاتف الدولي
   * يقبل أرقام بين 10 و 15 رقماً (معيار E.164)
   */
  isValidPhoneNumber(phone: string): boolean {
    const formatted = this.formatPhoneNumber(phone);
    // E.164: رمز الدولة (1-3) + رقم الخط (7-12) = 7-15 رقماً
    return /^\d{7,15}$/.test(formatted);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📚 ملاحظات إضافية:
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 1. Rate Limits:
 *    - الرسائل: 80 رسالة/ثانية (للحسابات الموثقة)
 *    - الـ Media: 500 طلب/دقيقة
 * 
 * 2. Conversation Pricing:
 *    - User-initiated: عندما العميل يبدأ المحادثة
 *    - Business-initiated: عندما المتجر يبدأ (يتطلب Template)
 *    - الرسائل داخل 24-hour window مجانية (بعد رسالة العميل)
 * 
 * 3. Session Window:
 *    - بعد رسالة من العميل، لديك 24 ساعة للرد برسائل عادية
 *    - بعد 24 ساعة، يجب استخدام Template
 * 
 * 4. Template Guidelines:
 *    - لا رسائل ترويجية في الـ Utility templates
 *    - يجب أن تكون الرسالة مفيدة للعميل
 *    - أوقات الموافقة: 1-2 يوم عادة
 * 
 * 5. Best Practices:
 *    - استخدم Retry مع Exponential Backoff
 *    - احفظ الـ message_id لتتبع الحالة
 *    - تعامل مع 24-hour window بحكمة
 *    - استخدم Interactive Messages لتجربة أفضل
 */
