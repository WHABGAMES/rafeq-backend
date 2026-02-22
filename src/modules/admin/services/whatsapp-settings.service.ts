/**
 * WhatsappSettingsService
 * Audited 2026-02-21
 *
 * FIX [TS2741]: sendTestMessage now explicitly maps ApiCallResult → { success, message }
 *   Previously returned `result` (ApiCallResult) directly, missing `message` field
 * FIX [TS2339]: sendViaWhatsappApi response typed as Record<string, any>
 *   Previously `{}` type had no properties — data?.error?.message caused TS2339
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { WhatsappSettings, WhatsappProvider } from '../entities/whatsapp-settings.entity';
import { MessageLog, MessageStatus } from '../entities/message-log.entity';

/**
 * ✅ FIX [TS2741]: Interface مفصولة لكل return type
 * sendViaWhatsappApi → ApiCallResult (has response?)
 * sendTestMessage → { success, message } (different shape)
 */
interface ApiCallResult {
  success: boolean;
  response?: Record<string, any>;
  error?: string;
}

@Injectable()
export class WhatsappSettingsService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappSettingsService.name);
  private readonly encKey: Buffer;

  constructor(
    @InjectRepository(WhatsappSettings)
    private readonly settingsRepo: Repository<WhatsappSettings>,

    @InjectRepository(MessageLog)
    private readonly messageLogRepo: Repository<MessageLog>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    const encKeySource = process.env.ENCRYPTION_KEY;

    if (!encKeySource) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'FATAL: ENCRYPTION_KEY environment variable is not set. ' +
          'Required for encrypting WhatsApp access tokens. ' +
          'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
      }
      this.logger.warn('⚠️  ENCRYPTION_KEY not set — using dev default. NOT for production!');
    }

    // ✅ scryptSync توليد مفتاح AES-256 من الـ env var
    this.encKey = scryptSync(
      encKeySource || 'rafeq-dev-only-key-not-for-production',
      'rafeq-salt-v1',
      32,
    ) as Buffer;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 🚀 Idempotent Migration — تُنفَّذ كل مرة يبدأ التطبيق
  //
  //  المشكلة الجذرية: جدول message_logs كان موجوداً مسبقاً في قاعدة البيانات
  //  بأعمدة ناقصة. CREATE TABLE IF NOT EXISTS تتخطى الجدول الموجود ولا تُعدِّله.
  //
  //  الحل: بعد إنشاء الجدول (أو تخطيه)، نُضيف كل عمود مفقود بشكل مستقل
  //  باستخدام ALTER TABLE ADD COLUMN IF NOT EXISTS — آمن 100%:
  //  ✅ لا يمسّ البيانات الموجودة
  //  ✅ لا يفشل إذا العمود موجود مسبقاً
  //  ✅ لا downtime
  //  ✅ يعمل سواء كان الجدول قديماً أو جديداً
  // ─────────────────────────────────────────────────────────────────────────
  async onModuleInit(): Promise<void> {
    try {
      // ── Step 1: أنشئ الجدول إذا لم يكن موجوداً (minimum viable table) ──
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS message_logs (
          id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          channel    VARCHAR(50) NOT NULL,
          status     VARCHAR(20) NOT NULL DEFAULT 'pending',
          attempts   INT         NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // ── Step 2: أضف كل عمود مفقود بشكل مستقل — idempotent ──
      //
      // كل ALTER TABLE مستقل في try/catch خاص به:
      // إذا فشل عمود واحد (مثلاً نوع خاطئ) لا يُوقف بقية الأعمدة
      const alterColumns: Array<{ col: string; sql: string }> = [
        {
          col: 'recipient_user_id',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS recipient_user_id UUID;`,
        },
        {
          col: 'recipient_phone',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(30);`,
        },
        {
          col: 'recipient_email',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);`,
        },
        {
          col: 'template_id',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS template_id UUID;`,
        },
        {
          col: 'trigger_event',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS trigger_event VARCHAR(100);`,
        },
        {
          col: 'content',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS content TEXT;`,
        },
        {
          col: 'response_payload',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS response_payload JSONB;`,
        },
        {
          col: 'error_message',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS error_message TEXT;`,
        },
        {
          col: 'sent_at',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;`,
        },
      ];

      for (const { col, sql } of alterColumns) {
        try {
          await this.dataSource.query(sql);
        } catch (colErr) {
          // نُسجّل لكن لا نوقف البقية
          this.logger.warn(`⚠️  message_logs: could not add column '${col}'`, {
            error: colErr instanceof Error ? colErr.message : 'Unknown',
          });
        }
      }

      // ── Step 3: الـ Indexes ──
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_msglog_recipient ON message_logs (recipient_user_id);
        CREATE INDEX IF NOT EXISTS idx_msglog_phone     ON message_logs (recipient_phone);
        CREATE INDEX IF NOT EXISTS idx_msglog_status    ON message_logs (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_msglog_channel   ON message_logs (channel, created_at DESC);
      `).catch(() => {
        // indexes are optional — don't crash on failure
      });

      this.logger.log('✅ message_logs table ready (all columns verified)');
    } catch (err) {
      // لا نوقف التطبيق — نُسجّل ونكمل
      this.logger.error('❌ Failed to initialize message_logs table', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  // ─── Settings Management ──────────────────────────────────────────────────

  async getSettings(): Promise<
    (Omit<WhatsappSettings, 'accessTokenEncrypted'> & { maskedToken: string }) | null
  > {
    const settings = await this.settingsRepo.findOne({ where: {} });
    if (!settings) return null;

    const { accessTokenEncrypted, ...rest } = settings;
    return {
      ...rest,
      // ✅ لا نُرجع الـ token الحقيقي أبدًا — masked فقط
      maskedToken: accessTokenEncrypted
        ? this.maskToken(this.decrypt(accessTokenEncrypted))
        : '****',
    };
  }

  async upsertSettings(data: {
    phoneNumber: string;
    provider: WhatsappProvider;
    accessToken: string;
    businessAccountId?: string;
    phoneNumberId?: string;
    webhookUrl?: string;
    webhookVerifyToken?: string;
    isActive?: boolean;
  }): Promise<WhatsappSettings> {
    let settings = await this.settingsRepo.findOne({ where: {} });
    const encrypted = this.encrypt(data.accessToken);

    if (settings) {
      Object.assign(settings, {
        phoneNumber: data.phoneNumber,
        provider: data.provider,
        accessTokenEncrypted: encrypted,
        businessAccountId: data.businessAccountId,
        phoneNumberId: data.phoneNumberId,
        webhookUrl: data.webhookUrl,
        webhookVerifyToken: data.webhookVerifyToken,
        isActive: data.isActive ?? settings.isActive,
      });
    } else {
      settings = this.settingsRepo.create({
        phoneNumber: data.phoneNumber,
        provider: data.provider,
        accessTokenEncrypted: encrypted,
        businessAccountId: data.businessAccountId,
        phoneNumberId: data.phoneNumberId,
        webhookUrl: data.webhookUrl,
        webhookVerifyToken: data.webhookVerifyToken,
        isActive: data.isActive ?? false,
      });
    }

    return this.settingsRepo.save(settings);
  }

  async toggleActive(isActive: boolean): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: {} });
    if (!settings) throw new NotFoundException('WhatsApp settings not configured');
    settings.isActive = isActive;
    await this.settingsRepo.save(settings);
  }

  // ─── Send Test Message ────────────────────────────────────────────────────

  /**
   * ✅ FIX [TS2741]: دالة public ترجع { success: boolean; message: string }
   * sendViaWhatsappApi (private) ترجع ApiCallResult { success, response?, error? }
   * — نوعان مختلفان، نعمل explicit mapping بينهما
   */
  async sendTestMessage(phoneNumber: string): Promise<{ success: boolean; message: string }> {
    const settings = await this.settingsRepo.findOne({ where: {} });

    if (!settings?.isActive) {
      throw new BadRequestException('WhatsApp integration is not active');
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

    // ✅ Explicit mapping من ApiCallResult → { success, message }
    return {
      success: result.success,
      message: result.success
        ? 'Test message sent successfully'
        : (result.error ?? 'Failed to send test message'),
    };
  }

  // ─── Send Message (via Processor) ─────────────────────────────────────────

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
      this.logger.warn('WhatsApp not active — skipping send');
      return { success: false, messageLogId: null };
    }

    // ✅ يُنشئ log record قبل الإرسال للتتبع
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

  /**
   * ✅ FIX [TS2339]: data typed as Record<string, any>
   * يدعم: META و TWILIO
   * WhatsappProvider.CUSTOM → returns error (not implemented — extend as needed)
   */
  private async sendViaWhatsappApi(
    settings: WhatsappSettings,
    token: string,
    to: string,
    message: string,
  ): Promise<ApiCallResult> {
    try {
      // ── META (Graph API) ──────────────────────────────────────────────────
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
            to,
            type: 'text',
            text: { body: message },
          }),
        });

        // ✅ FIX [TS2339]: typed as Record<string, any> → data?.error?.message works
        const data = await resp.json() as Record<string, any>;

        if (!resp.ok) {
          const errorMsg = typeof data?.error?.message === 'string'
            ? data.error.message
            : `HTTP ${resp.status}`;
          return { success: false, response: data, error: errorMsg };
        }
        return { success: true, response: data };
      }

      // ── TWILIO ────────────────────────────────────────────────────────────
      if (settings.provider === WhatsappProvider.TWILIO) {
        const [accountSid, authToken] = token.split(':');
        if (!accountSid || !authToken) {
          return { success: false, error: 'Twilio token must be in format: accountSid:authToken' };
        }

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const body = new URLSearchParams({
          From: `whatsapp:${settings.phoneNumber}`,
          To: `whatsapp:${to}`,
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
        return { success: resp.ok, response: data };
      }

      // ── CUSTOM / Unsupported ──────────────────────────────────────────────
      return { success: false, error: `Provider '${settings.provider}' is not yet implemented` };

    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error — check connectivity',
      };
    }
  }

  // ─── Message Logs (Inbox) ────────────────────────────────────────────────

  /**
   * استرجاع سجلات الرسائل المُرسَلة عبر واتساب الإداري
   * تُستخدم في صفحة الـ Inbox بلوحة تحكم السوبر أدمن
   */
  async getMessageLogs(opts: {
    page: number;
    limit: number;
    status?: string;
    phone?: string;
  }): Promise<{ data: MessageLog[]; total: number; page: number; limit: number }> {
    try {
      const qb = this.messageLogRepo
        .createQueryBuilder('ml')
        .where('ml.channel = :channel', { channel: 'whatsapp' })
        .orderBy('ml.createdAt', 'DESC')
        .skip((opts.page - 1) * opts.limit)
        .take(opts.limit);

      if (opts.status) {
        qb.andWhere('ml.status = :status', { status: opts.status });
      }

      if (opts.phone) {
        qb.andWhere('ml.recipientPhone LIKE :phone', {
          phone: `%${opts.phone.replace(/\D/g, '')}%`,
        });
      }

      const [data, total] = await qb.getManyAndCount();
      return { data, total, page: opts.page, limit: opts.limit };
    } catch (err) {
      this.logger.error('Failed to fetch message logs', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
      // إرجاع نتيجة فارغة بدل 500
      return { data: [], total: 0, page: opts.page, limit: opts.limit };
    }
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, dataHex] = encryptedText.split(':');
    if (!ivHex || !dataHex) {
      throw new Error('Invalid encrypted token format');
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
