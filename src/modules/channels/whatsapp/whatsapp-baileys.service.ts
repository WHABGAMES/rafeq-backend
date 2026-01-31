/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ - WhatsApp Baileys Service                                ║
 * ║                                                                                ║
 * ║  ⚠️ تحذير: هذه الطريقة غير رسمية وقد تؤدي لحظر الرقم                          ║
 * ║  يستخدم مكتبة @whiskeysockets/baileys للاتصال بـ WhatsApp Web                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  BaileysEventMap,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import * as path from 'path';
import * as fs from 'fs';

import { Channel, ChannelStatus, ChannelType } from '../entities/channel.entity';

interface ActiveSession {
  socket: WASocket;
  qrCode?: string;
  qrExpiresAt?: Date;
  status: 'connecting' | 'qr_ready' | 'connected' | 'disconnected';
}

@Injectable()
export class WhatsAppBaileysService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppBaileysService.name);
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly sessionsPath = path.join(process.cwd(), 'whatsapp-sessions');

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {
    // إنشاء مجلد الجلسات
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  async onModuleDestroy() {
    // إغلاق جميع الجلسات عند إيقاف التطبيق
    for (const [sessionId, session] of this.sessions) {
      try {
        session.socket?.end(undefined);
      } catch (e) {
        // ignore
      }
    }
    this.sessions.clear();
  }

  /**
   * ✅ بدء جلسة جديدة وتوليد QR Code
   */
  async initSession(channelId: string): Promise<{
    sessionId: string;
    qrCode: string | null;
    status: string;
  }> {
    this.logger.log(`Initializing WhatsApp session for channel ${channelId}`);

    const sessionId = `wa_${channelId}`;
    const sessionPath = path.join(this.sessionsPath, sessionId);

    // التحقق من وجود جلسة نشطة
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      return {
        sessionId,
        qrCode: existing.qrCode || null,
        status: existing.status,
      };
    }

    try {
      // تحميل حالة المصادقة
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      // إنشاء Socket
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Rafiq', 'Chrome', '1.0.0'],
      });

      // تخزين الجلسة
      const session: ActiveSession = {
        socket: sock,
        status: 'connecting',
      };
      this.sessions.set(sessionId, session);

      // الاستماع للأحداث
      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR Code جديد
        if (qr) {
          this.logger.log(`QR Code generated for session ${sessionId}`);
          
          // تحويل QR إلى صورة Base64
          const qrImage = await QRCode.toDataURL(qr);
          
          session.qrCode = qrImage;
          session.qrExpiresAt = new Date(Date.now() + 60000); // 1 دقيقة
          session.status = 'qr_ready';

          // حفظ في Database
          await this.channelRepository.update(
            { id: channelId },
            {
              qrCode: qrImage,
              qrExpiresAt: session.qrExpiresAt,
              status: ChannelStatus.PENDING,
            },
          );
        }

        // تم الاتصال
        if (connection === 'open') {
          this.logger.log(`WhatsApp connected for session ${sessionId}`);
          
          session.status = 'connected';
          session.qrCode = undefined;

          // جلب معلومات الحساب
          const user = sock.user;
          
          await this.channelRepository.update(
            { id: channelId },
            {
              status: ChannelStatus.CONNECTED,
              whatsappPhoneNumber: user?.id?.split(':')[0] || user?.id,
              whatsappDisplayName: user?.name,
              connectedAt: new Date(),
              qrCode: undefined,
            },
          );
        }

        // تم الفصل
        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.logger.warn(`WhatsApp disconnected for session ${sessionId}`, {
            statusCode,
            shouldReconnect,
          });

          session.status = 'disconnected';

          if (shouldReconnect) {
            // إعادة الاتصال
            this.sessions.delete(sessionId);
            setTimeout(() => this.initSession(channelId), 5000);
          } else {
            // تسجيل خروج - حذف الجلسة
            this.sessions.delete(sessionId);
            
            await this.channelRepository.update(
              { id: channelId },
              {
                status: ChannelStatus.DISCONNECTED,
                sessionData: undefined,
              },
            );

            // حذف ملفات الجلسة
            if (fs.existsSync(sessionPath)) {
              fs.rmSync(sessionPath, { recursive: true });
            }
          }
        }
      });

      // الاستماع للرسائل
      sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
          for (const msg of m.messages) {
            if (!msg.key.fromMe) {
              // رسالة واردة
              this.logger.debug(`Incoming message on session ${sessionId}`);
              
              // TODO: إرسال للـ Message Handler
              // await this.messageHandler.handleIncoming(channelId, msg);
              
              // تحديث إحصائيات
              await this.channelRepository.increment(
                { id: channelId },
                'messagesReceived',
                1,
              );
              await this.channelRepository.update(
                { id: channelId },
                { lastActivityAt: new Date() },
              );
            }
          }
        }
      });

      return {
        sessionId,
        qrCode: session.qrCode || null,
        status: session.status,
      };

    } catch (error) {
      this.logger.error(`Failed to init session ${sessionId}`, error);
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * ✅ الحصول على حالة الجلسة
   */
  async getSessionStatus(sessionId: string): Promise<{
    qrCode: string | null;
    status: string;
    expiresAt: Date | null;
  }> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      // محاولة جلب من Database
      const channelId = sessionId.replace('wa_', '');
      const channel = await this.channelRepository.findOne({
        where: { id: channelId },
        select: ['qrCode', 'qrExpiresAt', 'status'],
      });

      return {
        qrCode: channel?.qrCode || null,
        status: channel?.status || 'disconnected',
        expiresAt: channel?.qrExpiresAt || null,
      };
    }

    return {
      qrCode: session.qrCode || null,
      status: session.status,
      expiresAt: session.qrExpiresAt || null,
    };
  }

  /**
   * ✅ إرسال رسالة نصية
   */
  async sendTextMessage(
    channelId: string,
    to: string,
    text: string,
  ): Promise<boolean> {
    const sessionId = `wa_${channelId}`;
    const session = this.sessions.get(sessionId);

    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp session not connected');
    }

    try {
      // تنسيق الرقم
      const jid = this.formatPhoneNumber(to);

      await session.socket.sendMessage(jid, { text });

      // تحديث إحصائيات
      await this.channelRepository.increment(
        { id: channelId },
        'messagesSent',
        1,
      );
      await this.channelRepository.update(
        { id: channelId },
        { lastActivityAt: new Date() },
      );

      return true;
    } catch (error) {
      this.logger.error(`Failed to send message on channel ${channelId}`, error);
      throw error;
    }
  }

  /**
   * ✅ إرسال رسالة مع صورة
   */
  async sendImageMessage(
    channelId: string,
    to: string,
    imageUrl: string,
    caption?: string,
  ): Promise<boolean> {
    const sessionId = `wa_${channelId}`;
    const session = this.sessions.get(sessionId);

    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp session not connected');
    }

    try {
      const jid = this.formatPhoneNumber(to);

      await session.socket.sendMessage(jid, {
        image: { url: imageUrl },
        caption,
      });

      await this.channelRepository.increment(
        { id: channelId },
        'messagesSent',
        1,
      );

      return true;
    } catch (error) {
      this.logger.error(`Failed to send image on channel ${channelId}`, error);
      throw error;
    }
  }

  /**
   * ✅ فصل الجلسة
   */
  async disconnectSession(channelId: string): Promise<void> {
    const sessionId = `wa_${channelId}`;
    const session = this.sessions.get(sessionId);

    if (session) {
      try {
        await session.socket.logout();
      } catch (e) {
        // ignore
      }
      this.sessions.delete(sessionId);
    }

    // حذف ملفات الجلسة
    const sessionPath = path.join(this.sessionsPath, sessionId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true });
    }

    await this.channelRepository.update(
      { id: channelId },
      {
        status: ChannelStatus.DISCONNECTED,
        sessionData: undefined,
        qrCode: undefined,
      },
    );
  }

  /**
   * ✅ تنسيق رقم الهاتف لـ WhatsApp
   */
  private formatPhoneNumber(phone: string): string {
    // إزالة كل شيء عدا الأرقام
    let cleaned = phone.replace(/\D/g, '');

    // إضافة رمز السعودية إذا لم يكن موجوداً
    if (cleaned.startsWith('0')) {
      cleaned = '966' + cleaned.substring(1);
    } else if (!cleaned.startsWith('966') && !cleaned.startsWith('+')) {
      cleaned = '966' + cleaned;
    }

    return cleaned + '@s.whatsapp.net';
  }

  /**
   * ✅ إعادة تشغيل الجلسات المحفوظة عند بدء التطبيق
   */
  async restoreActiveSessions(): Promise<void> {
    this.logger.log('Restoring active WhatsApp sessions...');

    const activeChannels = await this.channelRepository.find({
      where: {
        type: ChannelType.WHATSAPP_UNOFFICIAL,
        status: ChannelStatus.CONNECTED,
      },
      select: ['id'],
    });

    for (const channel of activeChannels) {
      try {
        await this.initSession(channel.id);
      } catch (error) {
        this.logger.error(`Failed to restore session for channel ${channel.id}`);
      }
    }

    this.logger.log(`Restored ${activeChannels.length} WhatsApp sessions`);
  }
}
