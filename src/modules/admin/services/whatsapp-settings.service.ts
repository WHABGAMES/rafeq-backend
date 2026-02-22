/**
 * WhatsappSettingsService — PRODUCTION READY v2
 * Audited & Fixed: 2026-02-22
 *
 * ╔══════════════════════════════════════════════════════════╗
 * ║  BUG-1: upsertSettings أعاد accessTokenEncrypted للفرنت  ║
 * ║         → SafeSettings (maskedToken فقط)                ║
 * ║  BUG-2: تحديث الإعدادات يستلزم إعادة كتابة Token دائماً ║
 * ║         → accessToken اختياري عند التحديث               ║
 * ║  BUG-3: META لا يتحقق من phoneNumberId قبل الإرسال      ║
 * ║         → validation في upsertSettings + sendMessage    ║
 * ║  BUG-4: رقم المستلم لا يُنظَّف قبل إرساله لـ API        ║
 * ║         → normalizePhoneNumber (+/00/spaces/dashes)     ║
 * ║  BUG-5: Custom provider يُحفظ ويفشل بصمت عند الإرسال   ║
 * ║         → error صريح + logger.warn عند الحفظ            ║
 * ║  BUG-6: decrypt() يستخدم split(':') → indexOf() أصح    ║
 * ╚══════════════════════════════════════════════════════════╝
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { WhatsappSettings, WhatsappProvider } from '../entities/whatsapp-settings.entity';
import { MessageLog, MessageStatus } from '../entities/message-log.entity';

interface ApiCallResult {
  success: boolean;
  response?: Record<string, any>;
  error?: string;
}

/**
 * [BUG-1 FIX] نوع آمن للإرجاع — يحذف accessTokenEncrypted ويضيف maskedToken
 * مُصدَّر ليُستخدم في الـ controller إذا احتيج
 */
export type SafeSettings = Omit<WhatsappSettings, 'accessTokenEncrypted'> & {
  maskedToken: string;
};

@Injectable()
export class WhatsappSettingsService {
  private readonly logger = new Logger(WhatsappSettingsService.name);
  private readonly encKey: Buffer;

  constructor(
    @InjectRepository(WhatsappSettings)
    private readonly settingsRepo: Repository<WhatsappSettings>,

    @InjectRepository(MessageLog)
    private readonly messageLogRepo: Repository<MessageLog>,
  ) {
    const encKeySource = process.env.ENCRYPTION_KEY;

    if (!encKeySource) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'FATAL: ENCRYPTION_KEY environment variable is not set. ' +
          'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
      }
      this.logger.warn('⚠️  ENCRYPTION_KEY not set — using dev default. NOT for production!');
    }

    this.encKey = scryptSync(
      encKeySource || 'rafeq-dev-only-key-not-for-production',
      'rafeq-salt-v1',
      32,
    ) as Buffer;
  }

  // ─── Settings Management ──────────────────────────────────────────────────

  /**
   * [BUG-1 FIX] يُرجَع SafeSettings — لا accessTokenEncrypted أبداً
   */
  async getSettings(): Promise<SafeSettings | null> {
    const settings = await this.settingsRepo.findOne({ where: {} });
    if (!settings) return null;
    return this.toSafeSettings(settings);
  }

  /**
   * [BUG-1 FIX] يُرجَع SafeSettings بدلاً من WhatsappSettings الخام
   * [BUG-2 FIX] accessToken اختياري عند التحديث — إذا فارغ يُحتفظ بالمشفر القديم
   * [BUG-3 FIX] phoneNumberId مطلوب عند provider = META
   * [BUG-5 FIX] Custom provider → logger.warn صريح
   */
  async upsertSettings(data: {
    phoneNumber: string;
    provider: WhatsappProvider;
    accessToken?: string;
    businessAccountId?: string;
    phoneNumberId?: string;
    webhookUrl?: string;
    webhookVerifyToken?: string;
    isActive?: boolean;
  }): Promise<SafeSettings> {
    const existing = await this.settingsRepo.findOne({ where: {} });
    const isUpdate = !!existing;

    // [BUG-2 FIX] عند الإنشاء الأول accessToken إلزامي، عند التحديث اختياري
    if (!isUpdate && !data.accessToken?.trim()) {
      throw new BadRequestException('accessToken مطلوب عند الإعداد الأول');
    }

    // [BUG-3 FIX] phoneNumberId إلزامي لـ META
    if (data.provider === WhatsappProvider.META && !data.phoneNumberId?.trim()) {
      throw new BadRequestException(
        'phoneNumberId مطلوب لـ Meta — ابحث عنه في Meta Business Manager تحت WhatsApp > Phone Numbers',
      );
    }

    // [BUG-5 FIX] تحذير صريح للـ Custom provider
    if (data.provider === WhatsappProvider.CUSTOM) {
      this.logger.warn(
        '[WhatsApp] Custom provider: الإعدادات ستُحفظ لكن الإرسال غير مطبق — الرسائل ستُرفض',
      );
    }

    let settings = existing;

    if (isUpdate && settings) {
      // [BUG-2 FIX] Token جديد فقط إذا أُرسل، وإلا نحتفظ بالمشفر القديم
      const newEncrypted = data.accessToken?.trim()
        ? this.encrypt(data.accessToken.trim())
        : settings.accessTokenEncrypted;

      // [STRICT TS FIX] undefined بدلاً من null — Entity type: string | undefined
      Object.assign(settings, {
        phoneNumber: data.phoneNumber.trim(),
        provider: data.provider,
        accessTokenEncrypted: newEncrypted,
        businessAccountId: data.businessAccountId?.trim() || undefined,
        phoneNumberId: data.phoneNumberId?.trim() || undefined,
        webhookUrl: data.webhookUrl?.trim() || undefined,
        webhookVerifyToken: data.webhookVerifyToken?.trim() || undefined,
        isActive: data.isActive ?? settings.isActive,
      });
    } else {
      settings = this.settingsRepo.create({
        phoneNumber: data.phoneNumber.trim(),
        provider: data.provider,
        accessTokenEncrypted: this.encrypt(data.accessToken!.trim()),
        businessAccountId: data.businessAccountId?.trim() || undefined,
        phoneNumberId: data.phoneNumberId?.trim() || undefined,
        webhookUrl: data.webhookUrl?.trim() || undefined,
        webhookVerifyToken: data.webhookVerifyToken?.trim() || undefined,
        isActive: data.isActive ?? false,
      });
    }

    const saved = await this.settingsRepo.save(settings!);

    // [BUG-1 FIX] يُرجَع SafeSettings — لا accessTokenEncrypted
    return this.toSafeSettings(saved);
  }

  async toggleActive(isActive: boolean): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: {} });
    if (!settings) throw new NotFoundException('WhatsApp settings not configured');
    settings.isActive = isActive;
    await this.settingsRepo.save(settings);
  }

  // ─── Send Test Message ────────────────────────────────────────────────────

  async sendTestMessage(phoneNumber: string): Promise<{ success: boolean; message: string }> {
    const settings = await this.settingsRepo.findOne({ where: {} });

    if (!settings?.isActive) {
      throw new BadRequestException('WhatsApp integration is not active');
    }

    // [BUG-3 FIX] تحقق قبل الإرسال (إعدادات قديمة قد تكون بدون phoneNumberId)
    if (settings.provider === WhatsappProvider.META && !settings.phoneNumberId) {
      throw new BadRequestException(
        'Phone Number ID غير مضبوط — قم بتحديث الإعدادات',
      );
    }

    const token = this.decrypt(settings.accessTokenEncrypted);
    const result = await this.sendViaWhatsappApi(
      settings,
      token,
      phoneNumber,
      'Test message from Rafeq Admin Panel 🎉',
    );

    settings.lastTestSentAt = new Date();
    settings.connectionStatus = result.success ? 'connected' : 'error';
    await this.settingsRepo.save(settings);

    return {
      success: result.success,
      message: result.success
        ? 'Test message sent successfully'
        : (result.error ?? 'Failed to send test message'),
    };
  }

  // ─── Send Message (via Queue Processor) ──────────────────────────────────

  async sendMessage(
    recipientPhone: string,
    message: string,
    options?: {
      recipientUserId?: string;
      templateId?: string;
      triggerEvent?: string;
    },
  ): Promise<{ success: boolean; messageLogId: string | null }> {
    const settings = await this.settingsRepo.findOne({ where: {} });

    if (!settings?.isActive) {
      this.logger.warn('[WhatsApp] Not active — skipping send');
      return { success: false, messageLogId: null };
    }

    // [BUG-3 FIX] تحقق من phoneNumberId قبل إنشاء الـ log
    if (settings.provider === WhatsappProvider.META && !settings.phoneNumberId) {
      this.logger.error('[WhatsApp] META phoneNumberId missing — cannot send');
      return { success: false, messageLogId: null };
    }

    // ✅ يُنشئ log قبل الإرسال للتتبع الكامل
    const log = await this.messageLogRepo.save(
      this.messageLogRepo.create({
        recipientUserId: options?.recipientUserId,
        recipientPhone,
        channel: 'whatsapp',
        templateId: options?.templateId,
        triggerEvent: options?.triggerEvent,
        content: message,
        status: MessageStatus.PENDING,
        attempts: 0,
      }),
    );

    try {
      const token = this.decrypt(settings.accessTokenEncrypted);
      const result = await this.sendViaWhatsappApi(settings, token, recipientPhone, message);

      await this.messageLogRepo.update(log.id, {
        status: result.success ? MessageStatus.SENT : MessageStatus.FAILED,
        attempts: 1,
        sentAt: result.success ? new Date() : undefined,
        responsePayload: result.response,
        errorMessage: result.error,
      });

      return { success: result.success, messageLogId: log.id };
    } catch (err) {
      await this.messageLogRepo.update(log.id, {
        status: MessageStatus.FAILED,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        attempts: 1,
      });
      return { success: false, messageLogId: log.id };
    }
  }

  // ─── API Call (Private) ───────────────────────────────────────────────────

  private async sendViaWhatsappApi(
    settings: WhatsappSettings,
    token: string,
    to: string,
    message: string,
  ): Promise<ApiCallResult> {
    try {
      // [BUG-4 FIX] تنظيف رقم الهاتف قبل إرساله للـ API
      const normalizedPhone = this.normalizePhoneNumber(to);

      // ── META (Graph API v18.0) ────────────────────────────────────────────
      if (settings.provider === WhatsappProvider.META) {
        const url = `https://graph.facebook.com/v18.0/${settings.phoneNumberId}/messages`;

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normalizedPhone,
            type: 'text',
            text: { body: message },
          }),
        });

        const data = await resp.json() as Record<string, any>;

        if (!resp.ok) {
          const errorMsg = typeof data?.error?.message === 'string'
            ? data.error.message
            : `HTTP ${resp.status}`;
          this.logger.error('[WhatsApp META] API error', {
            status: resp.status,
            code: data?.error?.code,
            error: errorMsg,
          });
          return { success: false, response: data, error: errorMsg };
        }

        return { success: true, response: data };
      }

      // ── TWILIO ────────────────────────────────────────────────────────────
      if (settings.provider === WhatsappProvider.TWILIO) {
        // Token format: "accountSid:authToken"
        const colonIdx = token.indexOf(':');
        if (colonIdx === -1) {
          return {
            success: false,
            error: 'Twilio token يجب أن يكون بصيغة accountSid:authToken',
          };
        }
        const accountSid = token.slice(0, colonIdx);
        const authToken = token.slice(colonIdx + 1);

        if (!accountSid || !authToken) {
          return { success: false, error: 'Twilio token: accountSid أو authToken فارغ' };
        }

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const body = new URLSearchParams({
          From: `whatsapp:${settings.phoneNumber}`,
          To: `whatsapp:${normalizedPhone}`,
          Body: message,
        });

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });

        const data = await resp.json() as Record<string, any>;

        if (!resp.ok) {
          this.logger.error('[WhatsApp TWILIO] API error', { status: resp.status });
        }

        return {
          success: resp.ok,
          response: data,
          error: resp.ok ? undefined : (data?.message ?? `HTTP ${resp.status}`),
        };
      }

      // ── CUSTOM / Unsupported [BUG-5 FIX] ─────────────────────────────────
      return {
        success: false,
        error: `Provider '${settings.provider}' غير مطبق. استخدم Meta أو Twilio.`,
      };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Network error';
      this.logger.error('[WhatsApp] sendViaWhatsappApi failed', { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  // ─── Phone Normalization [BUG-4 FIX] ─────────────────────────────────────

  /**
   * يُوحِّد صيغة رقم الهاتف قبل إرساله للـ API:
   *   +966 50-123 4567  →  966501234567
   *   +971561667877     →  971561667877
   *   00966501234567    →  966501234567
   */
  private normalizePhoneNumber(phone: string): string {
    // إزالة المسافات والشرطات والأقواس والنقاط
    let normalized = phone.replace(/[\s\-().]/g, '');
    // إزالة + من البداية
    normalized = normalized.replace(/^\+/, '');
    // تحويل بادئة 00 إلى رمز الدولة مباشرة (00966 → 966)
    if (normalized.startsWith('00')) {
      normalized = normalized.slice(2);
    }
    return normalized;
  }

  // ─── toSafeSettings [BUG-1 FIX] ──────────────────────────────────────────

  private toSafeSettings(settings: WhatsappSettings): SafeSettings {
    const { accessTokenEncrypted, ...rest } = settings;
    return {
      ...rest,
      maskedToken: accessTokenEncrypted
        ? this.maskToken(this.decrypt(accessTokenEncrypted))
        : '****',
    };
  }

  // ─── Encryption (AES-256-CBC) ─────────────────────────────────────────────

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    // صيغة التخزين: {iv_hex}:{encrypted_hex}
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * [BUG-6 FIX] indexOf بدلاً من split(':')
   * IV = 32 hex chars دائماً، لكن indexOf أصح معمارياً
   */
  private decrypt(encryptedText: string): string {
    const colonIdx = encryptedText.indexOf(':');
    if (colonIdx === -1) {
      throw new Error('Invalid encrypted token format — missing separator');
    }
    const ivHex = encryptedText.slice(0, colonIdx);
    const dataHex = encryptedText.slice(colonIdx + 1);

    if (!ivHex || !dataHex) {
      throw new Error('Invalid encrypted token format — empty IV or data');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encKey, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private maskToken(token: string): string {
    if (!token || token.length < 8) return '****';
    return `${token.slice(0, 4)}${'*'.repeat(Math.max(0, token.length - 8))}${token.slice(-4)}`;
  }
}
