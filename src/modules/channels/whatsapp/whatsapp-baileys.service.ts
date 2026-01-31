/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - WhatsApp Baileys Service                   ║
 * ║                                                                                ║
 * ║  ✅ WhatsApp QR Connection via Baileys                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as path from 'path';
import * as fs from 'fs';

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  MessageUpsertType,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface WhatsAppSession {
  socket: WASocket;
  channelId: string;
  status: 'connecting' | 'qr_ready' | 'connected' | 'disconnected';
  qrCode?: string;
  qrExpiresAt?: Date;
  phoneNumber?: string;
}

export interface QRSessionResult {
  sessionId: string;
  qrCode: string;
  expiresAt: Date;
  status: 'pending' | 'scanning' | 'connected' | 'expired';
}

export interface ConnectionUpdate {
  connection?: ConnectionState['connection'];
  lastDisconnect?: { error?: Boom; date: Date };
  qr?: string;
}

export interface MessageUpsert {
  messages: WAMessage[];
  type: MessageUpsertType;
}

@Injectable()
export class WhatsAppBaileysService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppBaileysService.name);
  private readonly sessions = new Map<string, WhatsAppSession>();
  private readonly sessionsPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.sessionsPath = this.configService.get<string>(
      'WHATSAPP_SESSIONS_PATH',
      path.join(process.cwd(), 'whatsapp-sessions'),
    );

    // إنشاء مجلد الجلسات
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing all WhatsApp sessions...');
    
    for (const [channelId, session] of this.sessions) {
      try {
        session.socket?.end(undefined);
        this.logger.log(`Session closed: ${channelId}`);
      } catch (error) {
        this.logger.error(`Error closing session ${channelId}`, error);
      }
    }
    
    this.sessions.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Session Management
  // ═══════════════════════════════════════════════════════════════════════════════

  async initSession(channelId: string): Promise<QRSessionResult> {
    this.logger.log(`Initializing WhatsApp session for channel: ${channelId}`);

    // إغلاق جلسة قديمة إن وجدت
    if (this.sessions.has(channelId)) {
      await this.closeSession(channelId);
    }

    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Rafiq Platform', 'Chrome', '120.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: true,
    });

    const session: WhatsAppSession = {
      socket: sock,
      channelId,
      status: 'connecting',
    };

    this.sessions.set(channelId, session);

    // حفظ credentials عند التحديث
    sock.ev.on('creds.update', saveCreds);

    // معالجة تحديثات الاتصال
    sock.ev.on('connection.update', async (update: ConnectionUpdate) => {
      await this.handleConnectionUpdate(channelId, update);
    });

    // معالجة الرسائل الواردة
    sock.ev.on('messages.upsert', async (messageUpdate: MessageUpsert) => {
      await this.handleIncomingMessages(channelId, messageUpdate);
    });

    // انتظار QR أو الاتصال
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Session initialization timeout'));
      }, 60000);

      const checkStatus = setInterval(() => {
        const currentSession = this.sessions.get(channelId);
        
        if (currentSession?.status === 'qr_ready' && currentSession.qrCode) {
          clearInterval(checkStatus);
          clearTimeout(timeout);
          resolve({
            sessionId: channelId,
            qrCode: currentSession.qrCode,
            expiresAt: currentSession.qrExpiresAt || new Date(Date.now() + 60000),
            status: 'pending',
          });
        } else if (currentSession?.status === 'connected') {
          clearInterval(checkStatus);
          clearTimeout(timeout);
          resolve({
            sessionId: channelId,
            qrCode: '',
            expiresAt: new Date(),
            status: 'connected',
          });
        }
      }, 500);
    });
  }

  async getSessionStatus(channelId: string): Promise<QRSessionResult | null> {
    const session = this.sessions.get(channelId);
    
    if (!session) {
      return null;
    }

    return {
      sessionId: channelId,
      qrCode: session.qrCode || '',
      expiresAt: session.qrExpiresAt || new Date(),
      status: this.mapStatus(session.status),
    };
  }

  async closeSession(channelId: string): Promise<void> {
    const session = this.sessions.get(channelId);
    
    if (session) {
      try {
        session.socket?.end(undefined);
      } catch (error) {
        this.logger.error(`Error closing socket for ${channelId}`, error);
      }
      
      this.sessions.delete(channelId);
      this.logger.log(`Session closed: ${channelId}`);
    }
  }

  async deleteSession(channelId: string): Promise<void> {
    await this.closeSession(channelId);

    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
    
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      this.logger.log(`Session files deleted: ${channelId}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📨 Messaging
  // ═══════════════════════════════════════════════════════════════════════════════

  async sendTextMessage(
    channelId: string,
    to: string,
    text: string,
  ): Promise<{ messageId: string }> {
    const session = this.sessions.get(channelId);
    
    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp session not connected');
    }

    const jid = this.formatJid(to);
    
    const result = await session.socket.sendMessage(jid, { text });
    
    this.logger.log(`Message sent to ${to} via channel ${channelId}`);
    
    return { messageId: result?.key?.id || '' };
  }

  async sendImageMessage(
    channelId: string,
    to: string,
    imageUrl: string,
    caption?: string,
  ): Promise<{ messageId: string }> {
    const session = this.sessions.get(channelId);
    
    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp session not connected');
    }

    const jid = this.formatJid(to);
    
    const result = await session.socket.sendMessage(jid, {
      image: { url: imageUrl },
      caption,
    });
    
    return { messageId: result?.key?.id || '' };
  }

  async sendDocumentMessage(
    channelId: string,
    to: string,
    documentUrl: string,
    fileName: string,
    mimeType: string,
  ): Promise<{ messageId: string }> {
    const session = this.sessions.get(channelId);
    
    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp session not connected');
    }

    const jid = this.formatJid(to);
    
    const result = await session.socket.sendMessage(jid, {
      document: { url: documentUrl },
      fileName,
      mimetype: mimeType,
    });
    
    return { messageId: result?.key?.id || '' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 Private Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleConnectionUpdate(
    channelId: string,
    update: ConnectionUpdate,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;
    const session = this.sessions.get(channelId);

    if (!session) return;

    // QR Code جديد
    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 300,
          margin: 2,
        });
        
        session.qrCode = qrDataUrl;
        session.qrExpiresAt = new Date(Date.now() + 60000);
        session.status = 'qr_ready';
        
        this.logger.log(`QR Code generated for channel: ${channelId}`);
        
        this.eventEmitter.emit('whatsapp.qr.generated', {
          channelId,
          qrCode: qrDataUrl,
          expiresAt: session.qrExpiresAt,
        });
      } catch (error) {
        this.logger.error(`Error generating QR for ${channelId}`, error);
      }
    }

    // الاتصال مفتوح
    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = undefined;
      
      // جلب رقم الهاتف
      const user = session.socket.user;
      if (user?.id) {
        session.phoneNumber = user.id.split(':')[0].split('@')[0];
      }
      
      this.logger.log(`WhatsApp connected: ${channelId}, phone: ${session.phoneNumber}`);
      
      this.eventEmitter.emit('whatsapp.connected', {
        channelId,
        phoneNumber: session.phoneNumber,
      });
    }

    // الاتصال مغلق
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      this.logger.warn(`Connection closed for ${channelId}, code: ${statusCode}`);
      
      if (statusCode === DisconnectReason.loggedOut) {
        // المستخدم سجل خروج
        session.status = 'disconnected';
        await this.deleteSession(channelId);
        
        this.eventEmitter.emit('whatsapp.logged_out', { channelId });
      } else if (shouldReconnect) {
        // محاولة إعادة الاتصال
        this.logger.log(`Attempting to reconnect: ${channelId}`);
        
        setTimeout(() => {
          this.initSession(channelId).catch((err) => {
            this.logger.error(`Reconnection failed for ${channelId}`, err);
          });
        }, 5000);
      }
    }
  }

  private async handleIncomingMessages(
    channelId: string,
    messageUpdate: MessageUpsert,
  ): Promise<void> {
    const { messages, type } = messageUpdate;
    
    if (type !== 'notify') return;

    for (const msg of messages) {
      // تجاهل الرسائل الصادرة
      if (msg.key.fromMe) continue;
      
      const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '') || '';
      const messageId = msg.key.id || '';
      const text = msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || '';
      const timestamp = msg.messageTimestamp 
        ? new Date(Number(msg.messageTimestamp) * 1000) 
        : new Date();

      this.logger.log(`Incoming message from ${from} on channel ${channelId}`);

      this.eventEmitter.emit('whatsapp.message.received', {
        channelId,
        from,
        messageId,
        text,
        timestamp,
        rawMessage: msg,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private formatJid(phoneNumber: string): string {
    // إزالة + و 00 من البداية
    let cleaned = phoneNumber.replace(/^\+|^00/, '');
    // إزالة أي حروف غير رقمية
    cleaned = cleaned.replace(/\D/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  private mapStatus(
    status: WhatsAppSession['status'],
  ): 'pending' | 'scanning' | 'connected' | 'expired' {
    switch (status) {
      case 'qr_ready':
        return 'pending';
      case 'connecting':
        return 'scanning';
      case 'connected':
        return 'connected';
      default:
        return 'expired';
    }
  }

  isConnected(channelId: string): boolean {
    const session = this.sessions.get(channelId);
    return session?.status === 'connected';
  }

  getConnectedSessions(): string[] {
    const connected: string[] = [];
    
    for (const [channelId, session] of this.sessions) {
      if (session.status === 'connected') {
        connected.push(channelId);
      }
    }
    
    return connected;
  }
}
