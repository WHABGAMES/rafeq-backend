/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - WhatsApp Baileys Service                   ║
 * ║                                                                                ║
 * ║  ✅ WhatsApp QR Connection via Baileys                                         ║
 * ║  ✅ إصلاحات: مسار الجلسات، معالجة الأخطاء، التوافق مع DigitalOcean             ║
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
  fetchLatestBaileysVersion,
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
  retryCount: number;
}

export interface QRSessionResult {
  sessionId: string;
  qrCode: string;
  expiresAt: Date;
  status: 'pending' | 'scanning' | 'connected' | 'expired';
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
    // ✅ إصلاح #1: استخدام /tmp كمسار افتراضي (قابل للكتابة في DigitalOcean)
    const defaultPath = path.join('/tmp', 'whatsapp-sessions');
    this.sessionsPath = this.configService.get<string>(
      'WHATSAPP_SESSIONS_PATH',
      defaultPath,
    );

    this.logger.log(`WhatsApp sessions path: ${this.sessionsPath}`);

    // إنشاء مجلد الجلسات مع معالجة أخطاء
    try {
      if (!fs.existsSync(this.sessionsPath)) {
        fs.mkdirSync(this.sessionsPath, { recursive: true });
        this.logger.log(`Created sessions directory: ${this.sessionsPath}`);
      }
      // ✅ اختبار إمكانية الكتابة
      const testFile = path.join(this.sessionsPath, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      this.logger.log('Sessions directory is writable ✅');
    } catch (error) {
      this.logger.error(`❌ Sessions directory NOT writable: ${this.sessionsPath}`, error);
      // محاولة استخدام /tmp كبديل
      const fallbackPath = path.join('/tmp', 'wa-sessions-fallback');
      try {
        fs.mkdirSync(fallbackPath, { recursive: true });
        (this as any).sessionsPath = fallbackPath;
        this.logger.warn(`Using fallback sessions path: ${fallbackPath}`);
      } catch (e) {
        this.logger.error('❌ Even fallback path failed!', e);
      }
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
    this.logger.log(`🔄 Initializing WhatsApp session for channel: ${channelId}`);

    // إغلاق جلسة قديمة إن وجدت
    if (this.sessions.has(channelId)) {
      this.logger.log(`Closing existing session for: ${channelId}`);
      await this.closeSession(channelId);
    }

    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
    this.logger.log(`Session path: ${sessionPath}`);

    try {
      // ✅ إصلاح #2: جلب أحدث إصدار من Baileys
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.log(`Using Baileys version: ${version}, isLatest: ${isLatest}`);

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      this.logger.log('Auth state loaded successfully');

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // ✅ طباعة QR في Terminal للتشخيص
        version, // ✅ استخدام أحدث إصدار
        browser: ['Rafiq Platform', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        markOnlineOnConnect: true,
        // ✅ إصلاح #3: إضافة logger مخصص لتقليل الضوضاء
        logger: {
          level: 'warn',
          child: () => ({
            level: 'warn',
            trace: () => {},
            debug: () => {},
            info: (...args: any[]) => this.logger.debug(`[Baileys] ${args.join(' ')}`),
            warn: (...args: any[]) => this.logger.warn(`[Baileys] ${args.join(' ')}`),
            error: (...args: any[]) => this.logger.error(`[Baileys] ${args.join(' ')}`),
            fatal: (...args: any[]) => this.logger.error(`[Baileys FATAL] ${args.join(' ')}`),
          }),
          trace: () => {},
          debug: () => {},
          info: (...args: any[]) => this.logger.debug(`[Baileys] ${args.join(' ')}`),
          warn: (...args: any[]) => this.logger.warn(`[Baileys] ${args.join(' ')}`),
          error: (...args: any[]) => this.logger.error(`[Baileys] ${args.join(' ')}`),
          fatal: (...args: any[]) => this.logger.error(`[Baileys FATAL] ${args.join(' ')}`),
        } as any,
      });

      this.logger.log('WASocket created successfully');

      const session: WhatsAppSession = {
        socket: sock,
        channelId,
        status: 'connecting',
        retryCount: 0,
      };

      this.sessions.set(channelId, session);

      // حفظ credentials عند التحديث
      sock.ev.on('creds.update', saveCreds);

      // ✅ معالجة تحديثات الاتصال
      sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        this.logger.debug(`Connection update for ${channelId}: ${JSON.stringify({
          connection: update.connection,
          hasQR: !!update.qr,
          lastDisconnect: update.lastDisconnect ? 'yes' : 'no',
        })}`);
        await this.handleConnectionUpdate(channelId, update);
      });

      // معالجة الرسائل الواردة
      sock.ev.on('messages.upsert', async (messageUpdate: MessageUpsert) => {
        await this.handleIncomingMessages(channelId, messageUpdate);
      });

      // ✅ إصلاح #4: انتظار QR أو الاتصال مع timeout أطول ومعالجة أفضل
      return new Promise((resolve, reject) => {
        const TIMEOUT = 90000; // 90 ثانية بدل 60
        
        const timeout = setTimeout(() => {
          clearInterval(checkStatus);
          this.logger.error(`❌ Session initialization timeout for ${channelId} after ${TIMEOUT}ms`);
          
          // لا نحذف الجلسة فوراً - ممكن QR يظهر بعد شوي
          const currentSession = this.sessions.get(channelId);
          if (currentSession?.status === 'connecting') {
            currentSession.status = 'disconnected';
          }
          
          reject(new Error(`Session initialization timeout after ${TIMEOUT / 1000}s. Please check server logs and try again.`));
        }, TIMEOUT);

        const checkStatus = setInterval(() => {
          const currentSession = this.sessions.get(channelId);
          
          if (!currentSession) {
            clearInterval(checkStatus);
            clearTimeout(timeout);
            reject(new Error('Session was destroyed'));
            return;
          }
          
          if (currentSession.status === 'qr_ready' && currentSession.qrCode) {
            clearInterval(checkStatus);
            clearTimeout(timeout);
            this.logger.log(`✅ QR Code ready for channel: ${channelId}`);
            resolve({
              sessionId: channelId,
              qrCode: currentSession.qrCode,
              expiresAt: currentSession.qrExpiresAt || new Date(Date.now() + 60000),
              status: 'pending',
            });
          } else if (currentSession.status === 'connected') {
            clearInterval(checkStatus);
            clearTimeout(timeout);
            this.logger.log(`✅ Already connected for channel: ${channelId}`);
            resolve({
              sessionId: channelId,
              qrCode: '',
              expiresAt: new Date(),
              status: 'connected',
            });
          } else if (currentSession.status === 'disconnected') {
            clearInterval(checkStatus);
            clearTimeout(timeout);
            reject(new Error('Session disconnected during initialization'));
          }
        }, 500);
      });

    } catch (error) {
      this.logger.error(`❌ Fatal error initializing session for ${channelId}:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // تنظيف
      this.sessions.delete(channelId);
      
      throw error;
    }
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
    
    try {
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        this.logger.log(`Session files deleted: ${channelId}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting session files for ${channelId}`, error);
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

  /**
   * ✅ معالجة تحديثات الاتصال من Baileys
   */
  private async handleConnectionUpdate(
    channelId: string,
    update: Partial<ConnectionState>,
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;
    const session = this.sessions.get(channelId);

    if (!session) return;

    // QR Code جديد
    if (qr) {
      try {
        this.logger.log(`📱 QR Code received for channel: ${channelId}`);
        
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });
        
        session.qrCode = qrDataUrl;
        session.qrExpiresAt = new Date(Date.now() + 60000);
        session.status = 'qr_ready';
        
        this.logger.log(`✅ QR Code generated successfully for channel: ${channelId} (length: ${qrDataUrl.length})`);
        
        this.eventEmitter.emit('whatsapp.qr.generated', {
          channelId,
          qrCode: qrDataUrl,
          expiresAt: session.qrExpiresAt,
        });
      } catch (error) {
        this.logger.error(`❌ Error generating QR for ${channelId}:`, error);
      }
    }

    // الاتصال مفتوح
    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = undefined;
      session.retryCount = 0;
      
      // جلب رقم الهاتف
      const user = session.socket.user;
      if (user?.id) {
        session.phoneNumber = user.id.split(':')[0].split('@')[0];
      }
      
      this.logger.log(`✅ WhatsApp connected: ${channelId}, phone: ${session.phoneNumber}`);
      
      this.eventEmitter.emit('whatsapp.connected', {
        channelId,
        phoneNumber: session.phoneNumber,
      });
    }

    // الاتصال مغلق
    if (connection === 'close') {
      const disconnectError = lastDisconnect?.error;
      let statusCode: number | undefined;
      
      // التحقق إذا كان Boom
      if (disconnectError && 'output' in disconnectError) {
        statusCode = (disconnectError as Boom).output?.statusCode;
      }
      
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      this.logger.warn(`⚠️ Connection closed for ${channelId}, code: ${statusCode}, error: ${disconnectError?.message || 'unknown'}`);
      
      if (statusCode === DisconnectReason.loggedOut) {
        session.status = 'disconnected';
        await this.deleteSession(channelId);
        this.eventEmitter.emit('whatsapp.logged_out', { channelId });
      } else if (shouldReconnect && session.retryCount < 3) {
        // ✅ إصلاح #5: حد أقصى لمحاولات إعادة الاتصال
        session.retryCount++;
        const delay = Math.min(5000 * session.retryCount, 15000);
        
        this.logger.log(`🔄 Attempting reconnect ${session.retryCount}/3 for ${channelId} in ${delay}ms`);
        
        setTimeout(() => {
          this.initSession(channelId).catch((err) => {
            this.logger.error(`❌ Reconnection failed for ${channelId}:`, err.message);
            session.status = 'disconnected';
          });
        }, delay);
      } else {
        session.status = 'disconnected';
        this.logger.error(`❌ Max retries reached for ${channelId}, giving up`);
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

      this.logger.log(`📩 Incoming message from ${from} on channel ${channelId}`);

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
    let cleaned = phoneNumber.replace(/^\+|^00/, '');
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

  /**
   * ✅ تشخيص حالة الخدمة
   */
  getDiagnostics(): Record<string, any> {
    return {
      sessionsPath: this.sessionsPath,
      sessionsPathExists: fs.existsSync(this.sessionsPath),
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        id,
        status: s.status,
        hasQR: !!s.qrCode,
        phoneNumber: s.phoneNumber,
        retryCount: s.retryCount,
      })),
    };
  }
}
