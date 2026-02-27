/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - WhatsApp Baileys Service                   ║
 * ║                                                                                ║
 * ║  ✅ v14 — إصلاح جذر مشكلة phone pairing "Couldn't link device"                ║
 * ║                                                                                ║
 * ║  FIX-1: @lid Resolution — حفظ lid→phone في DB يُستعاد عند كل restart           ║
 * ║  FIX-2: resolveJidForSending — حُذفت onWhatsApp(lid) الخاطئة                   ║
 * ║         @lid ليس رقم هاتف — API تقبل أرقام E.164 فقط                           ║
 * ║  FIX-3: onModuleInit — استعادة متوازية مع MAX_CONCURRENT_RESTORES=5            ║
 * ║  FIX-4: handleConnectionUpdate — تنظيف errorCount/disconnectedAt عند reconnect ║
 * ║  FIX-5: restoreSession — يُعيد تحميل lid→phone من DB قبل الاتصال              ║
 * ║  FIX-6: 🔐 تشفير بيانات الجلسة (مفاتيح واتساب الخاصة) قبل الحفظ في DB       ║
 * ║         يدعم الترحيل: البيانات القديمة (غير مشفرة) تُقرأ وتُشفَّر تلقائياً   ║
 * ║  FIX-7: 📱 Phone Pairing Code (3 إصلاحات):                                    ║
 * ║         • browser: Browsers.ubuntu (كان custom string يكسر البروتوكول)          ║
 * ║         • انتظار حدث 'connecting' (كان delay ثابت 5 ثوانٍ)                     ║
 * ║         • retry تلقائي مرة واحدة عند الفشل                                     ║
 * ║  FIX-8: 🔥 السبب الجذري لـ "Couldn't link device":                             ║
 * ║         WhatsApp يرسل connection:close (515/428) بعد requestPairingCode        ║
 * ║         كان الكود يُعيد الاتصال → يُنشئ socket جديد بـ method:'qr'             ║
 * ║         → يُفسد رمز الربط الأصلي → المستخدم يحصل على "Couldn't link device"   ║
 * ║         الحل: guard في handleConnectionUpdate يمنع إعادة الاتصال أثناء pairing ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { encrypt, decryptSafe, isEncrypted } from '@common/utils/encryption.util';

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  MessageUpsertType,
  WAMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { Channel, ChannelType, ChannelStatus } from '../entities/channel.entity';

// ── Silent Logger ─────────────────────────────────────────────────────────────
const noopFn = () => {};
const silentLogger = {
  level: 'silent', child: () => silentLogger,
  trace: noopFn, debug: noopFn, info: noopFn,
  warn: noopFn, error: noopFn, fatal: noopFn,
} as any;

// ── Types ─────────────────────────────────────────────────────────────────────

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

/**
 * FIX-1: إضافة lidMappings لحفظ ربط @lid → رقم هاتف بشكل دائم في DB
 */
interface StoredSessionData {
  creds: string;
  keys: Record<string, string>;
  lidMappings?: Record<string, string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const QR_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 90_000;
const RECONNECT_BASE_DELAY_MS = 5_000;
/** FIX-3: أقصى عدد جلسات تُستعاد بالتوازي */
const MAX_CONCURRENT_RESTORES = 5;
/** FIX-1: debounce قبل حفظ lid mappings في DB */
const LID_PERSIST_DEBOUNCE_MS = 3_000;

@Injectable()
export class WhatsAppBaileysService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(WhatsAppBaileysService.name);
  private readonly sessions = new Map<string, WhatsAppSession>();

  /** FIX-1: خريطة lid→phone في الذاكرة */
  private readonly lidToPhone = new Map<string, Map<string, string>>();

  /** FIX-1: debounce timers لحفظ lid mappings في DB */
  private readonly lidPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private sessionsPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {
    this.sessionsPath = this.initializeSessionsPath();
  }

  // ── DB Session Management ──────────────────────────────────────────────────

  private async saveSessionToDB(channelId: string, sessionPath: string): Promise<void> {
    try {
      const credsPath = path.join(sessionPath, 'creds.json');
      if (!fs.existsSync(credsPath)) return;

      const creds = fs.readFileSync(credsPath, 'utf8');
      const keys: Record<string, string> = {};
      const files = fs.readdirSync(sessionPath);
      for (const file of files) {
        if (file !== 'creds.json' && file.endsWith('.json')) {
          keys[file] = fs.readFileSync(path.join(sessionPath, file), 'utf8');
        }
      }

      // FIX-1: حفظ lid mappings ضمن بيانات الجلسة
      const channelMap = this.lidToPhone.get(channelId);
      const lidMappings: Record<string, string> = {};
      if (channelMap) {
        for (const [lid, phone] of channelMap) lidMappings[lid] = phone;
      }

      const sessionData: StoredSessionData = { creds, keys, lidMappings };
      const plainJson = JSON.stringify(sessionData);
      // 🔐 تشفير بيانات الجلسة (مفاتيح واتساب الخاصة) قبل الحفظ في DB
      const encryptedData = encrypt(plainJson) ?? plainJson; // fallback للتطوير
      await this.channelRepository.update(channelId, { sessionData: encryptedData });

      this.logger.debug(
        `💾 Session saved to DB: ${channelId} ` +
        `(${Object.keys(keys).length} key files, ${Object.keys(lidMappings).length} lid mappings)`,
      );
    } catch (error) {
      this.logger.warn(`Failed to save session to DB: ${channelId} — ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private async restoreSessionFromDB(channelId: string, sessionPath: string): Promise<boolean> {
    try {
      const channel = await this.channelRepository.findOne({
        where: { id: channelId },
        select: ['id', 'sessionData'],
      });
      if (!channel?.sessionData) return false;

      // 🔐 فك تشفير البيانات — مع دعم البيانات القديمة (غير مشفرة) للترحيل
      let rawJson: string;
      if (isEncrypted(channel.sessionData)) {
        // decryptSafe تُرجع null بدل الاستثناء — آمنة للاستخدام هنا
        const decrypted = decryptSafe(channel.sessionData);
        if (!decrypted) {
          this.logger.error(`Failed to decrypt session data for ${channelId} — data may be corrupted or key mismatch`);
          return false;
        }
        rawJson = decrypted;
      } else {
        // بيانات قديمة غير مشفرة — نقرأها مباشرة ونُشفّرها عند الحفظ التالي
        this.logger.warn(`⚠️ Unencrypted session data detected for ${channelId} — will encrypt on next save`);
        rawJson = channel.sessionData;
      }

      const sessionData: StoredSessionData = JSON.parse(rawJson);

      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), sessionData.creds);
      for (const [fileName, content] of Object.entries(sessionData.keys)) {
        fs.writeFileSync(path.join(sessionPath, fileName), content);
      }

      // FIX-1: استعادة lid→phone في الذاكرة
      if (sessionData.lidMappings && Object.keys(sessionData.lidMappings).length > 0) {
        if (!this.lidToPhone.has(channelId)) this.lidToPhone.set(channelId, new Map());
        const map = this.lidToPhone.get(channelId)!;
        for (const [lid, phone] of Object.entries(sessionData.lidMappings)) map.set(lid, phone);
        this.logger.log(`📥 Restored ${Object.keys(sessionData.lidMappings).length} lid→phone mappings from DB for ${channelId}`);
      }

      this.logger.log(`📥 Session restored from DB: ${channelId} (${Object.keys(sessionData.keys).length} key files)`);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to restore session from DB: ${channelId} — ${error instanceof Error ? error.message : 'Unknown'}`);
      return false;
    }
  }

  /** FIX-1: جدولة حفظ lid mappings مع debounce لتجنب كتابات متكررة */
  private scheduleLidPersist(channelId: string): void {
    const existing = this.lidPersistTimers.get(channelId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.lidPersistTimers.delete(channelId);
      const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
      if (fs.existsSync(sessionPath)) {
        await this.saveSessionToDB(channelId, sessionPath);
      }
    }, LID_PERSIST_DEBOUNCE_MS);

    this.lidPersistTimers.set(channelId, timer);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * FIX-3: استعادة الجلسات بالتوازي مع حد أقصى = MAX_CONCURRENT_RESTORES
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('🔄 WhatsApp Baileys Service starting — checking for sessions to restore...');

    try {
      const connectedChannels = await this.channelRepository.find({
        where: { type: ChannelType.WHATSAPP_QR, status: ChannelStatus.CONNECTED },
      });

      if (connectedChannels.length === 0) {
        this.logger.log('📱 No connected WhatsApp QR channels found');
        return;
      }

      this.logger.log(
        `📱 Found ${connectedChannels.length} channel(s) to restore ` +
        `(batches of ${MAX_CONCURRENT_RESTORES})`,
      );

      for (let i = 0; i < connectedChannels.length; i += MAX_CONCURRENT_RESTORES) {
        const batch = connectedChannels.slice(i, i + MAX_CONCURRENT_RESTORES);

        const results = await Promise.allSettled(
          batch.map(async (channel: Channel) => {
            const sessionPath = path.join(this.sessionsPath, `wa_${channel.id}`);
            let hasAuthState = fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0;

            if (!hasAuthState) {
              this.logger.log(`📥 No local files for ${channel.id} — restoring from DB...`);
              hasAuthState = await this.restoreSessionFromDB(channel.id, sessionPath);
            }

            if (hasAuthState) {
              this.logger.log(`🔄 Restoring session: ${channel.id} (${channel.whatsappPhoneNumber || channel.name})`);
              await this.restoreSession(channel.id);
            } else {
              this.logger.warn(`⚠️ No auth state for ${channel.id} — marking disconnected`);
              await this.markChannelDisconnected(channel.id);
            }
          }),
        );

        results.forEach((result: PromiseSettledResult<void>, idx: number) => {
          if (result.status === 'rejected') {
            const ch = batch[idx];
            this.logger.error(`❌ Failed to restore ${ch.id}: ${(result as PromiseRejectedResult).reason instanceof Error ? (result as PromiseRejectedResult).reason.message : 'Unknown'}`);
            this.markChannelDisconnected(ch.id).catch(() => {});
          }
        });

        if (i + MAX_CONCURRENT_RESTORES < connectedChannels.length) {
          await this.delay(2000);
        }
      }

      this.logger.log('✅ Session restoration complete');
    } catch (error) {
      this.logger.error(`❌ Error during session restoration: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  /**
   * FIX-5: restoreSession — يُعيد تحميل lid→phone من DB قبل الاتصال
   */
  private async restoreSession(channelId: string): Promise<void> {
    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);

    // FIX-5: تأكد من وجود lid mappings في الذاكرة قبل أي إرسال
    if (!this.lidToPhone.has(channelId) || this.lidToPhone.get(channelId)!.size === 0) {
      try {
        const channel = await this.channelRepository.findOne({
          where: { id: channelId }, select: ['id', 'sessionData'],
        });
        if (channel?.sessionData) {
          let rawJson: string;
          if (isEncrypted(channel.sessionData)) {
            const decrypted = decryptSafe(channel.sessionData);
            rawJson = decrypted ?? channel.sessionData;
          } else {
            rawJson = channel.sessionData;
          }
          const stored: StoredSessionData = JSON.parse(rawJson);
          if (stored.lidMappings && Object.keys(stored.lidMappings).length > 0) {
            if (!this.lidToPhone.has(channelId)) this.lidToPhone.set(channelId, new Map());
            const map = this.lidToPhone.get(channelId)!;
            for (const [lid, phone] of Object.entries(stored.lidMappings)) map.set(lid, phone);
            this.logger.log(`📌 Pre-loaded ${map.size} lid→phone mappings for ${channelId}`);
          }
        }
      } catch { /* بيانات تالفة — تجاهل */ }
    }

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
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      logger: silentLogger,
      syncFullHistory: false,
    });

    const session: WhatsAppSession = {
      socket: sock, channelId, status: 'connecting', retryCount: 0,
      // 'qr' is correct here — restoreSession is for reconnecting already-authenticated sessions
      // (pairing_code sessions are protected by the guard in handleConnectionUpdate and never reach here)
      connectionMethod: 'qr',
    };
    this.sessions.set(channelId, session);

    sock.ev.on('creds.update', async () => { await saveCreds(); await this.saveSessionToDB(channelId, sessionPath); });
    sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => { await this.handleConnectionUpdate(channelId, update); });
    sock.ev.on('messages.upsert', async (update: MessageUpsert) => { await this.handleIncomingMessages(channelId, update); });
    sock.ev.on('contacts.upsert', (contacts: any[]) => { this.handleContactsUpsert(channelId, contacts); });
    sock.ev.on('messaging-history.set', (data: any) => { this.handleHistorySet(channelId, data); });
    sock.ev.on('contacts.update', (updates: any[]) => { this.handleContactsUpsert(channelId, updates); });
  }

  private async markChannelDisconnected(channelId: string): Promise<void> {
    try {
      await this.channelRepository.update(channelId, {
        status: ChannelStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        lastError: 'جلسة واتساب انتهت — يرجى إعادة مسح QR Code',
        lastErrorAt: new Date(),
      });
    } catch (error) {
      this.logger.error(`Failed to update channel status: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  private initializeSessionsPath(): string {
    const configPath = this.configService.get<string>('WHATSAPP_SESSIONS_PATH');
    const candidates = [configPath, path.join(process.cwd(), 'whatsapp-sessions'), '/tmp/whatsapp-sessions'].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) fs.mkdirSync(candidate, { recursive: true });
        const testFile = path.join(candidate, '.write-test');
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
        this.logger.log(`✅ Sessions directory: ${candidate}`);
        return candidate;
      } catch { this.logger.warn(`⚠️ Cannot write to: ${candidate}`); }
    }

    const fallback = '/tmp/wa-sessions';
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down all WhatsApp sessions...');
    for (const timer of this.lidPersistTimers.values()) clearTimeout(timer);
    this.lidPersistTimers.clear();

    for (const [channelId] of this.sessions) {
      const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
      await this.saveSessionToDB(channelId, sessionPath);
    }

    await Promise.allSettled(Array.from(this.sessions.keys()).map(id => this.closeSession(id)));
    this.sessions.clear();
  }

  // ── Session Init ──────────────────────────────────────────────────────────

  async initSession(channelId: string): Promise<QRSessionResult> {
    this.logger.log(`🔄 [QR] Init: ${channelId}`);
    return this.createBaileysSession(channelId, 'qr');
  }

  async initSessionWithPhoneCode(channelId: string, phoneNumber: string): Promise<QRSessionResult> {
    this.logger.log(`📱 [Phone] Init: ${channelId}, phone: ${phoneNumber}`);
    return this.createBaileysSession(channelId, 'phone_code', phoneNumber);
  }

  private async createBaileysSession(
    channelId: string,
    method: 'qr' | 'phone_code',
    phoneNumber?: string,
  ): Promise<QRSessionResult> {
    await this.fullCleanupSession(channelId);

    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    try {
      const { version } = await fetchLatestBaileysVersion();
      this.logger.log(`Baileys v${version.join('.')}`);

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
        version,
        printQRInTerminal: method === 'qr',
        // ✅ FIX: phone pairing requires Ubuntu browser string (Chrome custom breaks WhatsApp protocol)
        browser: method === 'phone_code' ? Browsers.ubuntu('Chrome') : ['Rafiq Platform', 'Chrome', '126.0.0'],
        connectTimeoutMs: 60_000, defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000, markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false, logger: silentLogger, syncFullHistory: false,
      });

      const session: WhatsAppSession = {
        socket: sock, channelId, status: 'connecting', retryCount: 0, connectionMethod: method, phoneNumber,
      };
      this.sessions.set(channelId, session);

      sock.ev.on('creds.update', async () => { await saveCreds(); await this.saveSessionToDB(channelId, sessionPath); });
      sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => { await this.handleConnectionUpdate(channelId, update); });
      sock.ev.on('messages.upsert', async (update: MessageUpsert) => { await this.handleIncomingMessages(channelId, update); });
      sock.ev.on('contacts.upsert', (contacts: any[]) => { this.handleContactsUpsert(channelId, contacts); });
      sock.ev.on('messaging-history.set', (data: any) => { this.handleHistorySet(channelId, data); });
      sock.ev.on('contacts.update', (updates: any[]) => { this.handleContactsUpsert(channelId, updates); });

      if (method === 'phone_code' && phoneNumber) {
        // ✅ FIX: Wait for 'connecting' event (socket handshake complete) BEFORE requesting code
        //    NOT a blind delay — WhatsApp server must complete the challenge first
        await new Promise<void>((resolve) => {
          let fallbackTimer: ReturnType<typeof setTimeout>;
          const onUpdate = (update: Partial<ConnectionState>) => {
            // 'connecting' = server handshake done, ready for pairing code
            if (update.connection === 'connecting' || update.connection === 'open') {
              clearTimeout(fallbackTimer);
              sock.ev.off('connection.update', onUpdate);
              resolve();
            }
          };
          sock.ev.on('connection.update', onUpdate);
          // Safety fallback: if no event in 8s, proceed anyway (cleans up listener too)
          fallbackTimer = setTimeout(() => {
            sock.ev.off('connection.update', onUpdate);
            resolve();
          }, 8000);
        });

        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        this.logger.log(`📱 Requesting pairing code for: ${cleanPhone}`);

        // ✅ FIX: Retry once if first attempt fails (network hiccup)
        let code: string | undefined;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            code = await sock.requestPairingCode(cleanPhone);
            break;
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.warn(`⚠️ Pairing code attempt ${attempt} failed: ${msg}`);
            if (attempt < 2) await this.delay(3000);
            else throw new Error(`فشل في إنشاء رمز الربط بعد محاولتين: ${msg}`);
          }
        }

        session.pairingCode = code;
        session.status = 'pairing_code';
        this.logger.log(`✅ Pairing code: ${code} for ${channelId}`);
        this.eventEmitter.emit('whatsapp.pairing_code.generated', { channelId, pairingCode: code });
        return { sessionId: channelId, qrCode: '', pairingCode: code!, expiresAt: new Date(Date.now() + QR_TIMEOUT_MS), status: 'pending', phoneNumber };
      }

      return new Promise<QRSessionResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearInterval(checker);
          const s = this.sessions.get(channelId);
          if (s && s.status !== 'connected') s.status = 'disconnected';
          reject(new Error('انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.'));
        }, INIT_TIMEOUT_MS);

        const checker = setInterval(() => {
          const current = this.sessions.get(channelId);
          if (!current) { clearInterval(checker); clearTimeout(timeout); reject(new Error('تم إنهاء الجلسة')); return; }

          if (current.status === 'qr_ready' && current.qrCode) {
            clearInterval(checker); clearTimeout(timeout);
            resolve({ sessionId: channelId, qrCode: current.qrCode, expiresAt: current.qrExpiresAt || new Date(Date.now() + QR_TIMEOUT_MS), status: 'pending' });
          } else if (current.status === 'connected') {
            clearInterval(checker); clearTimeout(timeout);
            resolve({ sessionId: channelId, qrCode: '', expiresAt: new Date(), status: 'connected', phoneNumber: current.phoneNumber });
          } else if (current.status === 'disconnected') {
            clearInterval(checker); clearTimeout(timeout);
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

  // ── Status ────────────────────────────────────────────────────────────────

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

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private async cleanupSession(channelId: string): Promise<void> {
    const existing = this.sessions.get(channelId);
    if (existing) {
      try {
        if (existing.socket) {
          existing.socket.ev.removeAllListeners('connection.update');
          existing.socket.ev.removeAllListeners('creds.update');
          existing.socket.ev.removeAllListeners('messages.upsert');
          existing.socket.ev.removeAllListeners('contacts.upsert');
          existing.socket.ev.removeAllListeners('contacts.update');
          existing.socket.ev.removeAllListeners('messaging-history.set');
          existing.socket.end(undefined);
        }
      } catch {}
      this.sessions.delete(channelId);
      // ✅ نحتفظ بـ lidToPhone عند cleanupSession — تُمحى فقط عند fullCleanup
      await this.delay(1000);
    }
  }

  private async fullCleanupSession(channelId: string): Promise<void> {
    const timer = this.lidPersistTimers.get(channelId);
    if (timer) { clearTimeout(timer); this.lidPersistTimers.delete(channelId); }

    await this.cleanupSession(channelId);

    const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
    try {
      if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(`Failed to delete session files: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    // مسح lid mappings من الذاكرة فقط عند الجلسة الجديدة
    this.lidToPhone.delete(channelId);
    try { await this.channelRepository.update(channelId, { sessionData: null as any }); } catch {}

    await this.delay(500);
  }

  async closeSession(channelId: string): Promise<void> {
    await this.cleanupSession(channelId);
    this.logger.log(`Session closed: ${channelId}`);
  }

  async deleteSession(channelId: string): Promise<void> {
    await this.fullCleanupSession(channelId);
    this.logger.log(`Session fully deleted: ${channelId}`);
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async sendTextMessage(channelId: string, to: string, text: string): Promise<{ messageId: string }> {
    const session = this.getConnectedSession(channelId);
    const resolvedJid = this.resolveJidForSending(channelId, to, session.socket!);
    this.logger.debug(`📤 Sending text: ${to} → resolved: ${resolvedJid}`);
    const result = await session.socket!.sendMessage(resolvedJid, { text });
    const messageId = result?.key?.id;
    if (!messageId) throw new Error(`WhatsApp send failed: no messageId for ${resolvedJid}`);
    this.logger.log(`✅ Sent: messageId=${messageId} to=${resolvedJid}`);
    return { messageId };
  }

  async sendImageMessage(channelId: string, to: string, imageUrl: string, caption?: string): Promise<{ messageId: string }> {
    const session = this.getConnectedSession(channelId);
    const resolvedJid = this.resolveJidForSending(channelId, to, session.socket!);
    const result = await session.socket!.sendMessage(resolvedJid, { image: { url: imageUrl }, caption });
    const messageId = result?.key?.id;
    if (!messageId) throw new Error(`WhatsApp image send failed: no messageId for ${resolvedJid}`);
    return { messageId };
  }

  async sendDocumentMessage(channelId: string, to: string, documentUrl: string, fileName: string, mimeType: string): Promise<{ messageId: string }> {
    const session = this.getConnectedSession(channelId);
    const resolvedJid = this.resolveJidForSending(channelId, to, session.socket!);
    const result = await session.socket!.sendMessage(resolvedJid, { document: { url: documentUrl }, fileName, mimetype: mimeType });
    const messageId = result?.key?.id;
    if (!messageId) throw new Error(`WhatsApp document send failed: no messageId for ${resolvedJid}`);
    return { messageId };
  }

  // ── Connection Update Handler ─────────────────────────────────────────────

  private async handleConnectionUpdate(channelId: string, update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;
    const session = this.sessions.get(channelId);
    if (!session) return;

    if (qr && session.connectionMethod === 'qr') {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });
        session.qrCode = qrDataUrl;
        session.qrExpiresAt = new Date(Date.now() + QR_TIMEOUT_MS);
        session.status = 'qr_ready';
        this.logger.log(`📱 QR ready: ${channelId}`);
        this.eventEmitter.emit('whatsapp.qr.generated', { channelId, qrCode: qrDataUrl, expiresAt: session.qrExpiresAt });
      } catch (error) { this.logger.error(`QR generation error: ${channelId}`, error); }
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

      try {
        // FIX-4: مسح كامل للأخطاء عند إعادة الاتصال
        await this.channelRepository.update(channelId, {
          status: ChannelStatus.CONNECTED,
          whatsappPhoneNumber: session.phoneNumber || undefined,
          connectedAt: new Date(),
          lastError: null as any,
          lastErrorAt: null as any,
          errorCount: 0,
          disconnectedAt: null as any,
        });
      } catch (e) {
        this.logger.warn(`Failed to update channel DB status on connect: ${e instanceof Error ? e.message : 'Unknown'}`);
      }

      const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
      await this.saveSessionToDB(channelId, sessionPath);
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error;
      let statusCode: number | undefined;
      if (error && 'output' in error) statusCode = (error as Boom).output?.statusCode;
      this.logger.warn(`⚠️ Disconnected: ${channelId}, code: ${statusCode}`);

      // ✅ FIX: رمز الربط نشط — لا تُعيد الاتصال أو تُنشئ socket جديد
      // WhatsApp يرسل close (515/428) بعد requestPairingCode مباشرة أحياناً
      // إعادة الاتصال هنا تُفسد رمز الربط وتُحوّل الجلسة إلى QR
      if (session.status === 'pairing_code') {
        this.logger.log(`📱 [${channelId}] Connection event during pairing — preserving pairing session, not reconnecting`);
        return;
      }

      try {
        await this.channelRepository.update(channelId, {
          lastError: `WhatsApp disconnected${statusCode ? ` (code: ${statusCode})` : ''}`,
          lastErrorAt: new Date(),
        });
      } catch {}

      if (statusCode === DisconnectReason.loggedOut) {
        session.status = 'disconnected';
        await this.deleteSession(channelId);
        await this.markChannelDisconnected(channelId);
        this.eventEmitter.emit('whatsapp.logged_out', { channelId });
        return;
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        this.logger.warn(`🔄 Session REPLACED: ${channelId} — another device took over.`);
        session.status = 'disconnected';
        await this.markChannelDisconnected(channelId);
        this.eventEmitter.emit('whatsapp.session_replaced', {
          channelId,
          message: 'Session was replaced by another device. Please re-scan QR code.',
        });
        return;
      }

      const sessionPath = path.join(this.sessionsPath, `wa_${channelId}`);
      await this.saveSessionToDB(channelId, sessionPath);

      if (session.retryCount < MAX_RETRIES) {
        session.retryCount++;
        const retryDelay = Math.min(RECONNECT_BASE_DELAY_MS * session.retryCount, 15_000);
        this.logger.log(`🔄 Retry ${session.retryCount}/${MAX_RETRIES} in ${retryDelay}ms`);
        setTimeout(async () => {
          try { await this.cleanupSession(channelId); await this.restoreSession(channelId); }
          catch { const s = this.sessions.get(channelId); if (s) s.status = 'disconnected'; }
        }, retryDelay);
      } else {
        session.status = 'disconnected';
        await this.markChannelDisconnected(channelId);
        this.eventEmitter.emit('whatsapp.max_retries', { channelId });
      }
    }
  }

  // ── Incoming Messages ─────────────────────────────────────────────────────

  private async handleIncomingMessages(channelId: string, messageUpdate: MessageUpsert): Promise<void> {
    const { messages, type } = messageUpdate;
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid || '';
        if (!jid) continue;
        if (jid.includes('@g.us') || jid.includes('@broadcast') || jid === 'status@broadcast') continue;

        const isLidJid = jid.includes('@lid');
        let realPhone: string | undefined = isLidJid ? undefined : jid.split('@')[0].replace(/\D/g, '');

        if (isLidJid) {
          const channelMap = this.lidToPhone.get(channelId);
          if (channelMap?.has(jid)) {
            realPhone = channelMap.get(jid);
            this.logger.log(`📱 Resolved @lid: ${jid} → ${realPhone}`);
          } else {
            this.logger.warn(`⚠️ @lid NOT resolved: ${jid} | Cache size: ${channelMap?.size || 0} | Will attempt resolution at send time`);
          }
        }

        this.eventEmitter.emit('whatsapp.message.received', {
          channelId,
          from: jid,
          fromPhone: realPhone,
          pushName: (msg as any).pushName || undefined,
          messageId: msg.key.id || '',
          text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || '',
          timestamp: msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000) : new Date(),
          rawMessage: msg,
        });
      } catch (err) {
        // ✅ FIX: catch per-message errors — one bad message won't crash the whole session
        this.logger.error(
          `❌ Failed to process incoming message on channel ${channelId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      }
    }
  }

  // ── Contacts Handler — FIX-1 ──────────────────────────────────────────────

  private handleContactsUpsert(channelId: string, contacts: any[]): void {
    if (!this.lidToPhone.has(channelId)) this.lidToPhone.set(channelId, new Map());
    const map = this.lidToPhone.get(channelId)!;
    let newMappings = 0;

    for (const contact of contacts) {
      try { newMappings += this.extractLidMapping(map, contact); } catch {}
    }

    if (newMappings > 0) {
      this.logger.log(`📇 Channel ${channelId}: ${newMappings} new lid mappings (total: ${map.size})`);
      this.scheduleLidPersist(channelId);
    }
  }

  /**
   * FIX-1: استخراج lid→phone من contact object — يتعامل مع جميع الحالات
   */
  private extractLidMapping(map: Map<string, string>, contact: any): number {
    let count = 0;
    const id = contact.id || '';
    const lid = contact.lid || '';

    // حالة 1: id = @s.whatsapp.net، lid = @lid
    if (id.includes('@s.whatsapp.net') && lid.includes('@lid')) {
      const phone = id.split('@')[0].replace(/\D/g, '');
      if (phone && !map.has(lid)) { map.set(lid, phone); count++; }
    }
    // حالة 2: id = @lid، lid = @s.whatsapp.net
    if (id.includes('@lid') && lid.includes('@s.whatsapp.net')) {
      const phone = lid.split('@')[0].replace(/\D/g, '');
      if (phone && !map.has(id)) { map.set(id, phone); count++; }
    }
    // حالة 3: id = @s.whatsapp.net بدون lid
    if (id.includes('@s.whatsapp.net') && !lid) {
      const phone = id.split('@')[0].replace(/\D/g, '');
      if (phone) map.set(id, phone);
    }
    // حالة 4: id = @lid — بحث في كل الحقول
    if (id.includes('@lid') && !map.has(id)) {
      for (const key of Object.keys(contact)) {
        const val = contact[key];
        if (typeof val === 'string' && val.includes('@s.whatsapp.net')) {
          const phone = val.split('@')[0].replace(/\D/g, '');
          if (phone) { map.set(id, phone); count++; break; }
        }
      }
    }

    return count;
  }

  private handleHistorySet(channelId: string, data: any): void {
    if (!this.lidToPhone.has(channelId)) this.lidToPhone.set(channelId, new Map());
    const map = this.lidToPhone.get(channelId)!;
    let newMappings = 0;

    try {
      const chats = data?.chats || [];
      for (const chat of chats) {
        const chatId = chat.id || '';
        const lidJid = chat.lidJid || chat.lid || '';
        if (chatId.includes('@s.whatsapp.net') && lidJid.includes('@lid')) {
          const phone = chatId.split('@')[0].replace(/\D/g, '');
          if (phone && !map.has(lidJid)) { map.set(lidJid, phone); newMappings++; }
        }
        if (chatId.includes('@lid') && lidJid.includes('@s.whatsapp.net')) {
          const phone = lidJid.split('@')[0].replace(/\D/g, '');
          if (phone && !map.has(chatId)) { map.set(chatId, phone); newMappings++; }
        }
      }
      if (data?.contacts?.length > 0) this.handleContactsUpsert(channelId, data.contacts);
    } catch (error) {
      this.logger.error(`Error processing messaging-history.set: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    if (newMappings > 0) {
      this.logger.log(`📜 Channel ${channelId}: ${newMappings} new mappings from history (total: ${map.size})`);
      this.scheduleLidPersist(channelId);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getConnectedSession(channelId: string): WhatsAppSession {
    const session = this.sessions.get(channelId);
    if (!session || session.status !== 'connected' || !session.socket) {
      throw new Error('جلسة واتساب غير متصلة');
    }
    return session;
  }

  /**
   * حلّ @lid إلى JID قابل للإرسال
   *
   * 🔑 الخوارزمية الصحيحة:
   * 1. JID = @s.whatsapp.net → إرجاع مباشر
   * 2. JID = @lid → بحث في الـ cache (مصدر contacts.upsert / messaging-history.set)
   * 3. إذا لم يوجد في الـ cache → إرسال لـ @lid مباشرة (صحيح للردود)
   *
   * ⛔ لماذا حذفنا sock.onWhatsApp(lidNumber):
   *    - onWhatsApp() تقبل أرقام هاتف E.164 فقط (مثل 966501234567)
   *    - @lid هو معرّف خصوصية داخلي في واتساب (مثل 67173456302225) — ليس رقم هاتف
   *    - الاستدعاء كان يفشل دائماً بصمت (try/catch) ويُضيّع 2-5 ثوانٍ في كل ردّ على @lid
   *    - الحلّ الصحيح: contacts.upsert هو المصدر الوحيد لخريطة lid→phone
   */
  private resolveJidForSending(channelId: string, jid: string, _sock: WASocket): string {
    if (!jid.includes('@lid')) return this.formatJid(jid);

    // Cache lookup — مبني من contacts.upsert / messaging-history.set / DB
    const channelMap = this.lidToPhone.get(channelId);
    if (channelMap?.has(jid)) {
      const phone = channelMap.get(jid)!;
      this.logger.log(`📤 Resolved @lid from cache: ${jid} → ${phone}@s.whatsapp.net`);
      return `${phone}@s.whatsapp.net`;
    }

    // إرسال مباشر لـ @lid — WhatsApp يوجّهه للشخص الصحيح
    // هذا سلوك صحيح للردود على محادثات @lid
    this.logger.warn(
      `📤 @lid not in cache: ${jid} | Cache size: ${channelMap?.size ?? 0} | ` +
      `Sending directly to @lid (correct behaviour for replies)`,
    );
    return jid;
  }

  private formatJid(phoneNumber: string): string {
    if (phoneNumber.includes('@')) return phoneNumber;
    const cleaned = phoneNumber.replace(/^\+|^00/, '').replace(/\D/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private mapStatus(status: WhatsAppSession['status']): 'pending' | 'scanning' | 'connected' | 'expired' {
    switch (status) {
      case 'qr_ready': case 'pairing_code': return 'pending';
      case 'connecting': return 'scanning';
      case 'connected': return 'connected';
      default: return 'expired';
    }
  }

  isConnected(channelId: string): boolean {
    return this.sessions.get(channelId)?.status === 'connected';
  }

  getConnectedSessions(): string[] {
    return Array.from(this.sessions.entries()).filter(([, s]) => s.status === 'connected').map(([id]) => id);
  }

  getDiagnostics(): Record<string, any> {
    return {
      sessionsPath: this.sessionsPath,
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        id, status: s.status, method: s.connectionMethod,
        hasQR: !!s.qrCode, hasPairingCode: !!s.pairingCode,
        phoneNumber: s.phoneNumber, retryCount: s.retryCount,
        lidMappings: this.lidToPhone.get(id)?.size || 0,
      })),
    };
  }
}
