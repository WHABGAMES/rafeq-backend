/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Channel Message Listener                         ║
 * ║                                                                                ║
 * ║  🔗 الجسر المفقود: يربط أحداث القنوات (واتساب، ديسكورد...) بنظام الرسائل      ║
 * ║                                                                                ║
 * ║  التدفق:                                                                      ║
 * ║  WhatsApp → 'channel.message.received' ─┐                                     ║
 * ║  Baileys  → 'whatsapp.message.received' ─┤→ هذا الـ Listener                  ║
 * ║  Discord  → 'channel.message.received' ──┘                                     ║
 * ║       ↓                                                                        ║
 * ║  1. يبحث عن Channel → يحصل على storeId                                        ║
 * ║  2. يبحث عن Store → يحصل على tenantId                                         ║
 * ║  3. يستدعي messageService.processIncomingMessage()                             ║
 * ║       ↓                                                                        ║
 * ║  messageService يحفظ الرسالة → يُطلق 'message.received'                       ║
 * ║       ↓                                                                        ║
 * ║  AIMessageListener يستقبل → يرد تلقائياً                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Channel, ChannelType, MessageType } from '@database/entities';
import { Store } from '../../stores/entities/store.entity';
import { MessageService } from '../services/message.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES — أشكال الأحداث من القنوات المختلفة
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * الشكل من WhatsApp Official (whatsapp.service.ts)
 * Event: 'channel.message.received'
 */
interface ChannelMessagePayload {
  channel: string;           // 'whatsapp' | 'discord' | etc.
  channelId: string;         // UUID من جدول channels
  externalMessageId: string; // معرف الرسالة الخارجي
  from: string;              // رقم المرسل (مثل 966501234567)
  customerName?: string;
  content?: string;
  type: string;              // 'text' | 'image' | 'video' | etc.
  mediaId?: string;
  mediaType?: string;
  interactiveReply?: {
    type: 'button' | 'list_item';
    id: string;
    title: string;
  };
  replyTo?: string;
  timestamp: Date;
  raw?: unknown;
}

/**
 * الشكل من WhatsApp QR / Baileys (whatsapp-baileys.service.ts)
 * Event: 'whatsapp.message.received'
 */
interface BaileysMessagePayload {
  channelId: string;
  from: string;        // Full JID (e.g. 967501234567@s.whatsapp.net or 67173456302225@lid)
  fromPhone?: string;  // Real phone number (only for @s.whatsapp.net, undefined for @lid)
  pushName?: string;   // WhatsApp display name
  messageId: string;
  text: string;
  timestamp: Date;
  rawMessage?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔗 CHANNEL MESSAGE LISTENER
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class ChannelMessageListener {
  private readonly logger = new Logger(ChannelMessageListener.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,

    private readonly messageService: MessageService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Official + Discord + Instagram
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('channel.message.received', { async: true })
  async handleChannelMessage(payload: ChannelMessagePayload): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `📥 Channel message received: ${payload.channel} from ${payload.from}`,
        { channelId: payload.channelId },
      );

      // 1️⃣ البحث عن القناة والمتجر
      const { channel, tenantId } = await this.resolveChannelAndTenant(
        payload.channelId,
      );

      if (!channel || !tenantId) {
        this.logger.warn(
          `⚠️ Skipping message: channel ${payload.channelId} has no valid store/tenant`,
        );
        return;
      }

      // 2️⃣ تحويل نوع الرسالة
      const messageType = this.mapMessageType(payload.type);

      // 3️⃣ معالجة الرسالة عبر MessageService
      const cleanPhone = this.cleanPhoneNumber(payload.from);

      const message = await this.messageService.processIncomingMessage({
        channelId: channel.id,
        channelType: channel.type,
        tenantId,
        externalMessageId: payload.externalMessageId,
        type: messageType,
        content: payload.content || '',
        timestamp: payload.timestamp || new Date(),
        senderExternalId: cleanPhone,
        senderName: payload.customerName,
        senderPhone: cleanPhone,
        interactiveReply: payload.interactiveReply,
        metadata: {
          raw: payload.raw ? 'present' : undefined,
          replyTo: payload.replyTo,
        },
      });

      // 4️⃣ تحديث عداد الرسائل فقط (lastActivityAt يُحدّث داخل transaction في message.service)
      await this.channelRepo.increment(
        { id: channel.id },
        'messagesReceived',
        1,
      );

      this.logger.log(
        `✅ Message processed: ${message.id} (${Date.now() - startTime}ms)`,
        {
          channelId: channel.id,
          storeId: channel.storeId,
          tenantId,
          from: payload.from,
        },
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to process channel message from ${payload.from}`,
        {
          error: error instanceof Error ? error.message : 'Unknown',
          channelId: payload.channelId,
          channel: payload.channel,
        },
      );
      // لا نعيد الخطأ — لا نريد أن يؤثر على القناة
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp QR (Baileys)
  // ═══════════════════════════════════════════════════════════════════════════

  @OnEvent('whatsapp.message.received', { async: true })
  async handleBaileysMessage(payload: BaileysMessagePayload): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `📥 Baileys message received from ${payload.from}`,
        { channelId: payload.channelId },
      );

      // 1️⃣ البحث عن القناة والمتجر
      const { channel, tenantId } = await this.resolveChannelAndTenant(
        payload.channelId,
      );

      if (!channel || !tenantId) {
        this.logger.warn(
          `⚠️ Skipping Baileys message: channel ${payload.channelId} has no valid store/tenant`,
        );
        return;
      }

      // 2️⃣ معالجة الرسالة
      // ✅ استخدام الـ JID الكامل للمطابقة والإرسال، والرقم النظيف للعرض
      const cleanPhone = payload.fromPhone || this.cleanPhoneNumber(payload.from);
      // ✅ @lid = معرّف داخلي وليس رقم حقيقي → لا نحفظه كرقم هاتف
      const isLid = payload.from.includes('@lid');
      const displayPhone = isLid ? undefined : cleanPhone;

      const message = await this.messageService.processIncomingMessage({
        channelId: channel.id,
        channelType: ChannelType.WHATSAPP_QR,
        tenantId,
        externalMessageId: payload.messageId,
        type: MessageType.TEXT,
        content: payload.text || '',
        timestamp: payload.timestamp || new Date(),
        senderExternalId: payload.from,  // ✅ JID كامل للمطابقة + الإرسال
        senderName: payload.pushName,     // ✅ اسم العميل من واتساب
        senderPhone: displayPhone,        // ✅ رقم حقيقي فقط (undefined لـ @lid)
      });

      // 3️⃣ تحديث عداد الرسائل فقط (lastActivityAt يُحدّث داخل transaction في message.service)
      await this.channelRepo.increment(
        { id: channel.id },
        'messagesReceived',
        1,
      );

      this.logger.log(
        `✅ Baileys message processed: ${message.id} (${Date.now() - startTime}ms)`,
        {
          channelId: channel.id,
          storeId: channel.storeId,
          tenantId,
          from: payload.from,
        },
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to process Baileys message from ${payload.from}`,
        {
          error: error instanceof Error ? error.message : 'Unknown',
          channelId: payload.channelId,
        },
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * يبحث عن القناة → المتجر → tenantId
   * هذا هو قلب عزل المتاجر: كل قناة مربوطة بمتجر واحد فقط
   */
  private async resolveChannelAndTenant(
    channelId: string,
  ): Promise<{ channel: Channel | null; tenantId: string | null }> {
    // البحث عن القناة مع تحميل المتجر
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      this.logger.warn(`Channel not found: ${channelId}`);
      return { channel: null, tenantId: null };
    }

    if (!channel.storeId) {
      this.logger.warn(`Channel ${channelId} has no storeId`);
      return { channel: null, tenantId: null };
    }

    // البحث عن المتجر للحصول على tenantId
    const store = await this.storeRepo.findOne({
      where: { id: channel.storeId },
      select: ['id', 'tenantId'],
    });

    if (!store?.tenantId) {
      this.logger.warn(
        `Store ${channel.storeId} not found or has no tenantId`,
      );
      return { channel: null, tenantId: null };
    }

    return { channel, tenantId: store.tenantId };
  }

  /**
   * تحويل أنواع الرسائل من واتساب لأنواع النظام
   */
  private mapMessageType(
    type: string,
  ): MessageType {
    const typeMap: Record<string, MessageType> = {
      text: MessageType.TEXT,
      image: MessageType.IMAGE,
      video: MessageType.VIDEO,
      audio: MessageType.AUDIO,
      document: MessageType.DOCUMENT,
      location: MessageType.LOCATION,
      sticker: MessageType.STICKER,
      contact: MessageType.CONTACT,
      interactive: MessageType.INTERACTIVE,
      button: MessageType.INTERACTIVE,
      template: MessageType.TEMPLATE,
    };

    return typeMap[type] || MessageType.TEXT;
  }

  /**
   * ✅ تنظيف رقم الهاتف من صيغة JID
   * Baileys يرسل: 67173456302225@s.whatsapp.net أو 67173456302225@lid
   * WhatsApp Official يرسل: 67173456302225
   * نحتاج: 67173456302225 (أرقام فقط)
   */
  private cleanPhoneNumber(raw: string): string {
    if (!raw) return '';
    // إزالة أي suffix بعد @ (مثل @s.whatsapp.net, @lid, @c.us)
    const withoutSuffix = raw.split('@')[0];
    // إزالة أي رموز غير رقمية (مثل + أو -)
    return withoutSuffix.replace(/\D/g, '');
  }
}
