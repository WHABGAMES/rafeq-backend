/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - WhatsApp Baileys Service                   ║
 * ║                                                                                ║
 * ║  ✅ QR Code + Phone Pairing Code Support                                      ║
 * ║  ✅ إصلاح Connection Failure (code 405)                                        ║
 * ║  ✅ Proper session cleanup + retry limits                                      ║
 * ║  ✅ Writable sessions path for DigitalOcean                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { Channel, ChannelType, ChannelStatus } from '../entities/channel.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Silent Logger - بديل pino بدون dependency خارجي
// ═══════════════════════════════════════════════════════════════════════════════

const noopFn = () => {};
const silentLogger = {
  level: 'silent',
  child: () => silentLogger,
  trace: noopFn,
  debug: noopFn,
  info: noopFn,
  warn: noopFn,
  error: noopFn,
  fatal: noopFn,
} as any;

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface WhatsAppSession {
  socket: WASocket | null;
  channelId: string;
  status: 'connecting' | 'qr_ready' | 'connected' | 'disconnected' | 'pairing_code';
  qrCode?: string;
  qrExpiresAt?: Date;
  pairingCode?: string;
  phoneNumber?: string;
  retryCount: number;
  connectionMethod: 'qr' | 'phone_code';
}

export interface QRSessionResult {
  sessionId: string;
  qrCode: string;
  pairingCode?: string;
  expiresAt: Date;
  status: 'pending' | 'scanning' | 'connected' | 'expired';
  phoneNumber?: string;
}

export interface MessageUpsert {
  messages: WAMessage[];
  type: MessageUpsertType;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_RETRIES = 3;
const QR_TIMEOUT_MS = 120000;
const INIT_TIMEOUT_MS = 90000;
const RECONNECT_BASE_DELAY_MS = 5000;

@Injectable()
export class WhatsAppBaileysService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(WhatsAppBaileysService.name);
  private readonly sessions = new Map<string, WhatsAppSession>();
  private sessionsPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {
    this.sessionsPath = this.initializeSessionsPath();
  }

  /**
   * ✅ عند بدء التشغيل: استعادة جلسات واتساب المتصلة
   * يبحث عن القنوات المسجلة كـ "متصل" في DB ويحاول إعادة الاتصال
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('🔄 WhatsApp Baileys Service starting - checking for sessions to restore...');

    try {
      const connectedChannels = await this.channelRepository.find({
        where: {
          type: ChannelType.WHATSAPP_QR,
          status: ChannelStatus.CONNECTED,
        },
      });

      if (connectedChannels.length === 0) {
        this.logger.log('📱 No connected WhatsApp QR channels found');
        return;
      }

      this.logger.log(`📱 Found ${connectedChannels.length} connected channel(s) to restore`);

      for (const channel of connectedChannels) {
        const sessionPath = path.join(this.sessionsPath, `wa_${channel.id}`);
        const hasAuthState = fs.existsSync(sessionPath) &&
          fs.readdirSync(sessionPath).length > 0;

        if (hasAuthState) {
          this.logger.log(`🔄 Restoring session for channel ${channel.id} (${channel.whatsappPhoneNumber || channel.name})`);
          try {
            await this.restoreSession(channel.id);
            this.logger.log(`✅ Session restored for channel ${channel.id}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown';
            this.logger.error(`❌ Failed to restore session ${channel.id}: ${msg}`);
            // حدّث الحالة في DB لتعكس الواقع
            await this.markChannelDisconnected(channel.id);
          }
        } else {
          this.logger.warn(`⚠️ No auth state files for channel ${channel.id} - marking as disconnected`);
          await this.markChannelDisconnected(channel.id);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Error during session restoration: ${msg}`);
    }
  }

  /**
   * استعادة جلسة واتساب بدون انتظار QR
   * يستخدم auth state المحفوظ على الملفات
   */
  private async restoreSession(channelId: string): Promise<void> {
    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      version,
      printQRInTerminal: false,
      browser: ['Rafiq Platform', 'Chrome', '126.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      logger: silentLogger,
      syncFullHistory: false,
    });

    const session: WhatsAppSession = {
      socket: sock,
      channelId,
      status: 'connecting',
      retryCount: 0,
      connectionMethod: 'qr',
    };

    this.sessions.set(channelId, session);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      await this.handleConnectionUpdate(channelId, update);
    });

    sock.ev.on('messages.upsert', async (messageUpdate: MessageUpsert) => {
      await this.handleIncomingMessages(channelId, messageUpdate);
    });
  }

  /**
   * تحديث حالة القناة في DB إلى disconnected
   */
  private async markChannelDisconnected(channelId: string): Promise<void> {
    try {
      await this.channelRepository.update(channelId, {
        status: ChannelStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        lastError: 'جلسة واتساب انتهت - يرجى إعادة مسح QR Code',
        lastErrorAt: new Date(),
      });
      this.logger.log(`📌 Channel ${channelId} marked as disconnected in DB`);
    } catch (error) {
      this.logger.error(`Failed to update channel status: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private initializeSessionsPath(): string {
    const configPath = this.configService.get<string>('WHATSAPP_SESSIONS_PATH');
    const candidates = [
      configPath,
      path.join(process.cwd(), 'whatsapp-sessions'),
      '/tmp/whatsapp-sessions',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) {
          fs.mkdirSync(candidate, { recursive: true });
        }
        const testFile = path.join(candidate, '.write-test');
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        this.logger.log(`✅ Sessions directory: ${candidate}`);
        return candidate;
      } catch {
        this.logger.warn(`⚠️ Cannot write to: ${candidate}`);
      }
    }

    const fallback = '/tmp/wa-sessions';
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down all WhatsApp sessions...');
    const promises: Promise<void>[] = [];
    for (const [channelId] of this.sessions) {
      promises.push(this.closeSession(channelId));
    }
    await Promise.allSettled(promises);
    this.sessions.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Session Init - QR Code
  // ═══════════════════════════════════════════════════════════════════════════════

  async initSession(channelId: string): Promise<QRSessionResult> {
    this.logger.log(`🔄 [QR] Init: ${channelId}`);
    return this.createBaileysSession(channelId, 'qr');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 Session Init - Phone Pairing Code
  // ═══════════════════════════════════════════════════════════════════════════════

  async initSessionWithPhoneCode(
    channelId: string,
    phoneNumber: string,
  ): Promise<QRSessionResult> {
    this.logger.log(`📱 [Phone] Init: ${channelId}, phone: ${phoneNumber}`);
    return this.createBaileysSession(channelId, 'phone_code', phoneNumber);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏗️ Core Session Builder
  // ═══════════════════════════════════════════════════════════════════════════════

  private async createBaileysSession(
    channelId: string,
    method: 'qr' | 'phone_code',
    phoneNumber?: string,
  ): Promise<QRSessionResult> {
    // ✅ تنظيف كامل
    await this.cleanupSession(channelId);

    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);

    try {
      const { version } = await fetchLatestBaileysVersion();
      this.logger.log(`Baileys v${version.join('.')}`);

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        version,
        printQRInTerminal: method === 'qr',
        browser: ['Rafiq Platform', 'Chrome', '126.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        logger: silentLogger,
        syncFullHistory: false,
      });

      const session: WhatsAppSession = {
        socket: sock,
        channelId,
        status: 'connecting',
        retryCount: 0,
        connectionMethod: method,
        phoneNumber,
      };

      this.sessions.set(channelId, session);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        await this.handleConnectionUpdate(channelId, update);
      });

      sock.ev.on('messages.upsert', async (messageUpdate: MessageUpsert) => {
        await this.handleIncomingMessages(channelId, messageUpdate);
      });

      // ✅ Phone Pairing Code
      if (method === 'phone_code' && phoneNumber) {
        await this.delay(3000); // انتظار لإنشاء اتصال أولي

        try {
          const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
          const code = await sock.requestPairingCode(cleanPhone);
          session.pairingCode = code;
          session.status = 'pairing_code';

          this.logger.log(`✅ Pairing code: ${code} for ${channelId}`);

          this.eventEmitter.emit('whatsapp.pairing_code.generated', {
            channelId,
            pairingCode: code,
          });

          return {
            sessionId: channelId,
            qrCode: '',
            pairingCode: code,
            expiresAt: new Date(Date.now() + QR_TIMEOUT_MS),
            status: 'pending' as const,
            phoneNumber,
          };
        } catch (error) {
          this.logger.error(`❌ Pairing code failed:`, error);
          throw new Error('فشل في إنشاء رمز الربط. تأكد من صحة رقم الهاتف.');
        }
      }

      // ✅ QR Method - انتظار QR أو الاتصال
      return new Promise<QRSessionResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearInterval(checker);
          const s = this.sessions.get(channelId);
          if (s && s.status !== 'connected') s.status = 'disconnected';
          reject(new Error('انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.'));
        }, INIT_TIMEOUT_MS);

        const checker = setInterval(() => {
          const current = this.sessions.get(channelId);
          if (!current) {
            clearInterval(checker);
            clearTimeout(timeout);
            reject(new Error('تم إنهاء الجلسة'));
            return;
          }

          if (current.status === 'qr_ready' && current.qrCode) {
            clearInterval(checker);
            clearTimeout(timeout);
            resolve({
              sessionId: channelId,
              qrCode: current.qrCode,
              expiresAt: current.qrExpiresAt || new Date(Date.now() + QR_TIMEOUT_MS),
              status: 'pending',
            });
          } else if (current.status === 'connected') {
            clearInterval(checker);
            clearTimeout(timeout);
            resolve({
              sessionId: channelId,
              qrCode: '',
              expiresAt: new Date(),
              status: 'connected',
              phoneNumber: current.phoneNumber,
            });
          } else if (current.status === 'disconnected') {
            clearInterval(checker);
            clearTimeout(timeout);
            reject(new Error('فشل الاتصال. يرجى المحاولة مرة أخرى.'));
          }
        }, 500);
      });
    } catch (error) {
      this.logger.error(`❌ Fatal: ${channelId}`, error instanceof Error ? error.message : error);
      this.sessions.delete(channelId);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Status
  // ═══════════════════════════════════════════════════════════════════════════════

  async getSessionStatus(channelId: string): Promise<QRSessionResult | null> {
    const session = this.sessions.get(channelId);
    if (!session) return null;

    return {
      sessionId: channelId,
      qrCode: session.qrCode || '',
      pairingCode: session.pairingCode,
      expiresAt: session.qrExpiresAt || new Date(),
      status: this.mapStatus(session.status),
      phoneNumber: session.phoneNumber,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧹 Cleanup
  // ═══════════════════════════════════════════════════════════════════════════════

  private async cleanupSession(channelId: string): Promise<void> {
    const existing = this.sessions.get(channelId);
    if (existing) {
      try {
        if (existing.socket) {
          existing.socket.ev.removeAllListeners('connection.update');
          existing.socket.ev.removeAllListeners('creds.update');
          existing.socket.ev.removeAllListeners('messages.upsert');
          existing.socket.end(undefined);
        }
      } catch {}
      this.sessions.delete(channelId);
      await this.delay(1000);
    }
  }

  async closeSession(channelId: string): Promise<void> {
    await this.cleanupSession(channelId);
    this.logger.log(`Session closed: ${channelId}`);
  }

  async deleteSession(channelId: string): Promise<void> {
    await this.closeSession(channelId);
    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
    try {
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      }
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📨 Messaging
  // ═══════════════════════════════════════════════════════════════════════════════

  async sendTextMessage(channelId: string, to: string, text: string): Promise<{ messageId: string }> {
    const session = this.getConnectedSession(channelId);
    const result = await session.socket!.sendMessage(this.formatJid(to), { text });
    return { messageId: result?.key?.id || '' };
  }

  async sendImageMessage(channelId: string, to: string, imageUrl: string, caption?: string): Promise<{ messageId: string }> {
    const session = this.getConnectedSession(channelId);
    const result = await session.socket!.sendMessage(this.formatJid(to), { image: { url: imageUrl }, caption });
    return { messageId: result?.key?.id || '' };
  }

  async sendDocumentMessage(channelId: string, to: string, documentUrl: string, fileName: string, mimeType: string): Promise<{ messageId: string }> {
    const session = this.getConnectedSession(channelId);
    const result = await session.socket!.sendMessage(this.formatJid(to), { document: { url: documentUrl }, fileName, mimetype: mimeType });
    return { messageId: result?.key?.id || '' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 Connection Update Handler
  // ═══════════════════════════════════════════════════════════════════════════════

  private async handleConnectionUpdate(channelId: string, update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;
    const session = this.sessions.get(channelId);
    if (!session) return;

    if (qr && session.connectionMethod === 'qr') {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        session.qrCode = qrDataUrl;
        session.qrExpiresAt = new Date(Date.now() + QR_TIMEOUT_MS);
        session.status = 'qr_ready';
        this.logger.log(`📱 QR ready: ${channelId}`);
        this.eventEmitter.emit('whatsapp.qr.generated', { channelId, qrCode: qrDataUrl, expiresAt: session.qrExpiresAt });
      } catch (error) {
        this.logger.error(`QR generation error: ${channelId}`, error);
      }
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.qrCode = undefined;
      session.pairingCode = undefined;
      session.retryCount = 0;
      const user = session.socket?.user;
      if (user?.id) session.phoneNumber = user.id.split(':')[0].split('@')[0];
      this.logger.log(`✅ Connected: ${channelId}, phone: ${session.phoneNumber}`);
      this.eventEmitter.emit('whatsapp.connected', { channelId, phoneNumber: session.phoneNumber });

      // ✅ مزامنة الحالة مع DB
      try {
        await this.channelRepository.update(channelId, {
          status: ChannelStatus.CONNECTED,
          whatsappPhoneNumber: session.phoneNumber || undefined,
          connectedAt: new Date(),
          lastError: undefined as any,
          errorCount: 0,
        });
      } catch (e) {
        this.logger.warn(`Failed to update channel DB status on connect: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error;
      let statusCode: number | undefined;
      if (error && 'output' in error) statusCode = (error as Boom).output?.statusCode;

      this.logger.warn(`⚠️ Disconnected: ${channelId}, code: ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut) {
        session.status = 'disconnected';
        await this.deleteSession(channelId);
        await this.markChannelDisconnected(channelId);
        this.eventEmitter.emit('whatsapp.logged_out', { channelId });
        return;
      }

      if (session.retryCount < MAX_RETRIES) {
        session.retryCount++;
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * session.retryCount, 15000);
        this.logger.log(`🔄 Retry ${session.retryCount}/${MAX_RETRIES} in ${delay}ms`);
        setTimeout(async () => {
          try {
            await this.createBaileysSession(channelId, session.connectionMethod, session.phoneNumber);
          } catch {
            const s = this.sessions.get(channelId);
            if (s) s.status = 'disconnected';
          }
        }, delay);
      } else {
        session.status = 'disconnected';
        await this.markChannelDisconnected(channelId);
        this.eventEmitter.emit('whatsapp.max_retries', { channelId });
      }
    }
  }

  private async handleIncomingMessages(channelId: string, messageUpdate: MessageUpsert): Promise<void> {
    const { messages, type } = messageUpdate;
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '') || '';
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const timestamp = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date();

      this.eventEmitter.emit('whatsapp.message.received', {
        channelId,
        from,
        messageId: msg.key.id || '',
        text,
        timestamp,
        rawMessage: msg,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private getConnectedSession(channelId: string): WhatsAppSession {
    const session = this.sessions.get(channelId);
    if (!session || session.status !== 'connected' || !session.socket) {
      throw new Error('جلسة واتساب غير متصلة');
    }
    return session;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private formatJid(phoneNumber: string): string {
    let cleaned = phoneNumber.replace(/^\+|^00/, '').replace(/\D/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  private mapStatus(status: WhatsAppSession['status']): 'pending' | 'scanning' | 'connected' | 'expired' {
    switch (status) {
      case 'qr_ready':
      case 'pairing_code':
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
    return this.sessions.get(channelId)?.status === 'connected';
  }

  getConnectedSessions(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([, s]) => s.status === 'connected')
      .map(([id]) => id);
  }

  getDiagnostics(): Record<string, any> {
    return {
      sessionsPath: this.sessionsPath,
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        id, status: s.status, method: s.connectionMethod,
        hasQR: !!s.qrCode, hasPairingCode: !!s.pairingCode,
        phoneNumber: s.phoneNumber, retryCount: s.retryCount,
      })),
    };
  }
}
