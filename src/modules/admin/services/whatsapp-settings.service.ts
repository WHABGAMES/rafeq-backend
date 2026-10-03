/**
 * WhatsappSettingsService
 * Audited 2026-02-21
 *
 * FIX [TS2741]: sendTestMessage now explicitly maps ApiCallResult → { success, message }
 *   Previously returned `result` (ApiCallResult) directly, missing `message` field
 * FIX [TS2339]: sendViaWhatsappApi response is validated as an unknown JSON record.
 *   Previously `{}` type had no properties — data?.error?.message caused TS2339
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, DataSource, IsNull, FindOptionsWhere } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { WhatsappSettings, WhatsappProvider } from '../entities/whatsapp-settings.entity';
import { MessageLog, MessageStatus } from '../entities/message-log.entity';
import { asJsonRecord, getJsonString } from '@common/utils/json-record.util';
import { MailService } from '../../mail/mail.service';

/**
 * ✅ FIX [TS2741]: Interface مفصولة لكل return type
 * sendViaWhatsappApi → ApiCallResult (has response?)
 * sendTestMessage → { success, message } (different shape)
 */
interface ApiCallResult {
  success: boolean;
  response?: Record<string, unknown>;
  error?: string;
  httpStatus?: number;
  providerErrorCode?: number;
}

type WhatsappTestDeliveryStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export interface WhatsappTestResult {
  success: boolean;
  status: 'accepted' | 'failed' | 'blocked';
  message: string;
  messageId?: string;
  messageLogId?: string;
}

export interface LatestWhatsappTest {
  id: string;
  recipientPhone: string | null;
  status: WhatsappTestDeliveryStatus;
  messageId: string | null;
  errorMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface MessageHistoryRow {
  id: string;
  recipientPhone: string | null;
  content: string | null;
  direction: string;
  status: string;
  attempts: number | string | null;
  errorMessage: string | null;
  sentAt: Date | string | null;
  createdAt: Date | string;
  triggerEvent: string | null;
}

export type SafeWhatsappSettings = Omit<WhatsappSettings, 'accessTokenEncrypted' | 'webhookVerifyToken'> & {
  maskedToken: string;
  hasAccessToken: boolean;
  hasWebhookVerifyToken: boolean;
  latestTest: LatestWhatsappTest | null;
};

const FAILURE_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const HEALTH_MONITOR_ADVISORY_LOCK_ID = 742_610_307;

@Injectable()
export class WhatsappSettingsService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappSettingsService.name);
  private readonly encKey: Buffer;
  private healthCheckRunning = false;

  constructor(
    @InjectRepository(WhatsappSettings)
    private readonly settingsRepo: Repository<WhatsappSettings>,

    @InjectRepository(MessageLog)
    private readonly messageLogRepo: Repository<MessageLog>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
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
        {
          col: 'direction',
          sql: `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'outbound';`,
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

    // إنشاء قناة الإدارة العامة تلقائياً إذا لم تكن موجودة.
    await this.ensureAdminChannel().catch(e =>
      this.logger.warn(`⚠️ ensureAdminChannel: ${e?.message}`),
    );
  }

  /**
   * يزامن القناة الداخلية الخاصة بصندوق الإدارة مع إعدادات واتساب العامة.
   * الدالة idempotent وتُستدعى عند التشغيل وبعد كل حفظ/تفعيل، لذلك لا تحتاج
   * إعادة تشغيل الخادم حتى يبدأ الاستقبال بعد تغيير Phone Number ID.
   */
  private async ensureAdminChannel(currentSettings?: WhatsappSettings): Promise<void> {
    const settings = currentSettings ?? await this.settingsRepo.findOne({
      where: { isActive: true, tenantId: IsNull() },
    });
    if (!settings?.isActive || !settings.phoneNumberId || settings.tenantId) return;

    const [existing] = await this.dataSource.query(
      `SELECT id, is_admin_channel FROM channels WHERE whatsapp_phone_number_id = $1 LIMIT 1`,
      [settings.phoneNumberId],
    );
    if (existing) {
      if (existing.is_admin_channel !== true) {
        throw new ConflictException(
          'Phone Number ID is already assigned to a store channel and cannot be reused for the admin inbox',
        );
      }
      await this.dataSource.query(
        `UPDATE channels
         SET is_admin_channel = true,
             status = 'connected',
             is_official = true,
             whatsapp_phone_number = $2,
             whatsapp_business_account_id = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [existing.id, settings.phoneNumber || '', settings.businessAccountId || null],
      );
      return;
    }

    // اختيار ثابت فقط لتلبية FK الحالي؛ is_admin_channel يمنع ظهور القناة للمتجر.
    const [store] = await this.dataSource.query(
      `SELECT id FROM stores
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    );
    if (!store) {
      this.logger.warn('ensureAdminChannel: no store exists to host the internal admin channel');
      return;
    }

    await this.dataSource.query(
        `INSERT INTO channels
           (id, store_id, type, name, status, is_official, is_admin_channel,
            whatsapp_phone_number_id, whatsapp_phone_number, whatsapp_business_account_id,
            connected_at, settings, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, 'whatsapp_official', $2, 'connected', true, true,
            $3, $4, $5,
            NOW(), '{}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [
          store.id,
          `Admin WhatsApp (${settings.phoneNumber || settings.phoneNumberId})`,
          settings.phoneNumberId,
          settings.phoneNumber || '',
          settings.businessAccountId || null,
        ],
      );

    this.logger.log(`✅ Admin WhatsApp channel created for phoneNumberId: ${settings.phoneNumberId}`);
  }

  // ─── Settings Management ──────────────────────────────────────────────────

  async getSettings(tenantId?: string): Promise<
    SafeWhatsappSettings | null
  > {
    // ✅ FIX CRITICAL: عزل تام بين التجار
    // tenantId موجود → إعدادات هذا التاجر فقط
    // tenantId غير موجود → الإعدادات العامة القديمة (tenant_id IS NULL) فقط
    // بدون هذا الفلتر: findOne({ where: {} }) يرجع سجل عشوائي = تسريب بيانات!
    const where = this.settingsWhere(tenantId);

    const settings = await this.settingsRepo.findOne({ where });
    if (!settings) return null;

    return this.toSafeSettings(settings, await this.getLatestTest(settings.id));
  }

  async upsertSettings(data: {
    tenantId?: string;
    phoneNumber: string;
    provider: WhatsappProvider;
    accessToken?: string;
    businessAccountId?: string;
    phoneNumberId?: string;
    webhookUrl?: string;
    webhookVerifyToken?: string;
    isActive?: boolean;
  }): Promise<SafeWhatsappSettings> {
    // ✅ FIX CRITICAL: فلترة حسب التاجر عند البحث عن إعدادات موجودة
    // بدون IsNull: findOne({ where: {} }) يلقط سجل أي تاجر ويكتب فوقه!
    const where = this.settingsWhere(data.tenantId);

    let settings = await this.settingsRepo.findOne({ where });

    if (data.provider === WhatsappProvider.CUSTOM) {
      throw new BadRequestException('Custom WhatsApp provider is not supported');
    }
    if (data.provider === WhatsappProvider.META && !data.phoneNumberId?.trim()) {
      throw new BadRequestException('phoneNumberId is required for Meta WhatsApp');
    }
    const accessToken = data.accessToken?.trim();
    if (!settings && !accessToken) {
      throw new BadRequestException('accessToken is required when creating WhatsApp settings');
    }

    if (settings) {
      Object.assign(settings, {
        tenantId: data.tenantId,
        phoneNumber: data.phoneNumber,
        provider: data.provider,
        businessAccountId: data.businessAccountId,
        phoneNumberId: data.phoneNumberId,
        webhookUrl: data.webhookUrl,
        isActive: data.isActive ?? settings.isActive,
      });
      if (accessToken) settings.accessTokenEncrypted = this.encrypt(accessToken);
      if (data.webhookVerifyToken?.trim()) {
        settings.webhookVerifyToken = data.webhookVerifyToken.trim();
      }
      settings.lastConfiguredAt = new Date();
    } else {
      settings = this.settingsRepo.create({
        tenantId: data.tenantId,
        phoneNumber: data.phoneNumber,
        provider: data.provider,
        accessTokenEncrypted: this.encrypt(accessToken as string),
        businessAccountId: data.businessAccountId,
        phoneNumberId: data.phoneNumberId,
        webhookUrl: data.webhookUrl,
        webhookVerifyToken: data.webhookVerifyToken,
        isActive: data.isActive ?? false,
        lastConfiguredAt: new Date(),
      });
    }

    const saved = await this.settingsRepo.save(settings);
    if (!saved.tenantId && saved.isActive) {
      await this.ensureAdminChannel(saved);
    }
    if (saved.isActive && saved.provider === WhatsappProvider.META && accessToken) {
      await this.checkMetaConnection(saved);
    }
    return this.toSafeSettings(saved, await this.getLatestTest(saved.id));
  }

  async toggleActive(isActive: boolean, tenantId?: string): Promise<SafeWhatsappSettings> {
    const where = this.settingsWhere(tenantId);

    const settings = await this.settingsRepo.findOne({ where });
    if (!settings) throw new NotFoundException('WhatsApp settings not configured');
    settings.isActive = isActive;
    settings.lastConfiguredAt = new Date();
    await this.settingsRepo.save(settings);
    if (isActive && !settings.tenantId) {
      await this.ensureAdminChannel(settings);
    }
    if (isActive && settings.provider === WhatsappProvider.META) {
      await this.checkMetaConnection(settings);
    }
    return this.toSafeSettings(settings, await this.getLatestTest(settings.id));
  }

  /**
   * Verifies active Meta connections in the background. Three consecutive
   * failures are required before marking a connection disconnected, which
   * avoids alerting the owner for a transient Meta/network outage.
   */
  async monitorConnections(): Promise<void> {
    if (this.healthCheckRunning) return;
    this.healthCheckRunning = true;
    const lockRunner = this.dataSource.createQueryRunner();
    let lockAcquired = false;
    try {
      await lockRunner.connect();
      const lockResult = await lockRunner.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [HEALTH_MONITOR_ADVISORY_LOCK_ID],
      );
      const lockRows = lockResult as unknown as Array<{ acquired: boolean }>;
      lockAcquired = lockRows[0]?.acquired === true;
      if (!lockAcquired) return;

      const settingsList = await this.settingsRepo.find({
        where: {
          isActive: true,
          provider: WhatsappProvider.META,
          tenantId: IsNull(),
        },
      });
      for (const settings of settingsList) {
        await this.checkMetaConnection(settings);
      }
    } catch (error) {
      this.logger.error('WhatsApp connection monitor failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      if (lockAcquired) {
        await lockRunner.query('SELECT pg_advisory_unlock($1)', [HEALTH_MONITOR_ADVISORY_LOCK_ID])
          .catch((error: unknown) => this.logger.error('Could not release WhatsApp monitor lock', {
            error: error instanceof Error ? error.message : 'Unknown error',
          }));
      }
      await lockRunner.release().catch((error: unknown) => this.logger.error(
        'Could not release WhatsApp monitor database connection',
        { error: error instanceof Error ? error.message : 'Unknown error' },
      ));
      this.healthCheckRunning = false;
    }
  }

  private async checkMetaConnection(settings: WhatsappSettings): Promise<void> {
    const checkedAt = new Date();
    try {
      if (!settings.phoneNumberId) throw new Error('Phone Number ID is missing');
      const token = this.decrypt(settings.accessTokenEncrypted);
      const response = await fetch(
        `${this.graphApiBaseUrl()}/${encodeURIComponent(settings.phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
      );
      const payload = asJsonRecord(await response.json()) ?? {};
      if (!response.ok) {
        throw new Error(
          getJsonString(asJsonRecord(payload.error), 'message') ?? `Meta HTTP ${response.status}`,
        );
      }

      settings.connectionStatus = 'connected';
      settings.consecutiveHealthFailures = 0;
      settings.lastConnectionError = null;
      settings.lastHealthCheckedAt = checkedAt;
      await this.settingsRepo.save(settings);
    } catch (error) {
      const reason = this.safeConnectionError(error);
      settings.lastHealthCheckedAt = checkedAt;
      settings.lastConnectionError = reason;
      settings.consecutiveHealthFailures = (settings.consecutiveHealthFailures || 0) + 1;

      if (settings.consecutiveHealthFailures >= FAILURE_THRESHOLD) {
        const wasDisconnected = settings.connectionStatus === 'disconnected';
        settings.connectionStatus = 'disconnected';
        const cooldownPassed = !settings.lastDisconnectAlertAt
          || checkedAt.getTime() - settings.lastDisconnectAlertAt.getTime() >= ALERT_COOLDOWN_MS;
        if (!wasDisconnected || cooldownPassed) {
          const delivered = await this.sendDisconnectAlert(settings, reason, checkedAt);
          if (delivered) settings.lastDisconnectAlertAt = checkedAt;
        }
      }
      await this.settingsRepo.save(settings);
    }
  }

  private async sendDisconnectAlert(
    settings: WhatsappSettings,
    reason: string,
    detectedAt: Date,
  ): Promise<boolean> {
    const recipient = this.configService.get<string>('WHATSAPP_ALERT_EMAIL')
      || this.configService.get<string>('BCC_EMAIL')
      || 'forwahabb@gmail.com';
    return this.mailService.sendMail({
      to: recipient,
      subject: 'تنبيه: انقطاع اتصال واتساب في منصة رفيق',
      text: [
        'تعذر التحقق من اتصال WhatsApp Business API بعد ثلاث محاولات متتالية.',
        `الرقم: ${settings.phoneNumber}`,
        `وقت الاكتشاف: ${detectedAt.toISOString()}`,
        `السبب: ${reason}`,
        'يرجى مراجعة إعدادات واتساب في لوحة الإدارة.',
      ].join('\n'),
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8">
        <h2 style="color:#dc2626">تعذر الاتصال بواتساب</h2>
        <p>فشل فحص WhatsApp Business API ثلاث مرات متتالية.</p>
        <p><strong>الرقم:</strong> ${this.escapeHtml(settings.phoneNumber)}</p>
        <p><strong>وقت الاكتشاف:</strong> ${this.escapeHtml(detectedAt.toISOString())}</p>
        <p><strong>السبب:</strong> ${this.escapeHtml(reason)}</p>
        <p>يرجى مراجعة صفحة إعدادات واتساب في لوحة الإدارة.</p>
      </div>`,
    });
  }

  // ─── Send Test Message ────────────────────────────────────────────────────

  /**
   * ✅ FIX [TS2741]: دالة public ترجع { success: boolean; message: string }
   * sendViaWhatsappApi (private) ترجع ApiCallResult { success, response?, error? }
   * — نوعان مختلفان، نعمل explicit mapping بينهما
   */
  async sendTestMessage(phoneNumber: string, tenantId?: string): Promise<WhatsappTestResult> {
    const where = this.settingsWhere(tenantId);

    const settings = await this.settingsRepo.findOne({ where });

    if (!settings?.isActive) {
      throw new BadRequestException('WhatsApp integration is not active');
    }

    if (settings.provider === WhatsappProvider.META && settings.connectionStatus !== 'connected') {
      return {
        success: false,
        status: 'blocked',
        message: 'WhatsApp connection is not available. Update the access token and verify the connection first.',
      };
    }

    const normalizedPhone = settings.provider === WhatsappProvider.META
      ? this.formatMetaRecipient(phoneNumber)
      : phoneNumber.trim();
    const testMessage = 'Test message from Rafeq Admin Panel 🎉';
    const log = await this.messageLogRepo.save(this.messageLogRepo.create({
      recipientPhone: normalizedPhone,
      channel: 'whatsapp',
      triggerEvent: 'admin_test',
      content: testMessage,
      status: MessageStatus.PENDING,
      attempts: 0,
      responsePayload: {
        whatsapp_settings_id: settings.id,
        delivery_status: 'pending',
      },
    }));

    let result: ApiCallResult;
    try {
      const token = this.decrypt(settings.accessTokenEncrypted);
      result = await this.sendViaWhatsappApi(
        settings,
        token,
        normalizedPhone,
        testMessage,
      );
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : 'Could not read the saved access token',
      };
    }

    // فشل رسالة الاختبار لا يعني أن الربط مفصول؛ قد ترفض Meta رسالة نصية
    // خارج نافذة خدمة العميل (24 ساعة) مع بقاء الرمز والرقم صالحين تماماً.
    // فحص الصحة الدوري وحده هو مصدر connectionStatus.
    if (result.success) {
      settings.lastTestSentAt = new Date();
      const messageId = getJsonString(result.response, 'message_id');
      log.status = MessageStatus.PENDING;
      log.attempts = 1;
      log.sentAt = settings.lastTestSentAt;
      log.responsePayload = {
        ...result.response,
        whatsapp_settings_id: settings.id,
        delivery_status: 'accepted',
      };
      await this.messageLogRepo.save(log);
      await this.settingsRepo.save(settings);
      return {
        success: true,
        status: 'accepted',
        message: 'Meta accepted the test message. Waiting for the delivery receipt.',
        messageId,
        messageLogId: log.id,
      };
    }

    log.status = MessageStatus.FAILED;
    log.attempts = 1;
    log.errorMessage = result.error ?? 'Failed to submit test message';
    log.responsePayload = {
      ...result.response,
      whatsapp_settings_id: settings.id,
      delivery_status: 'failed',
    };
    await this.messageLogRepo.save(log);

    if (this.isAuthenticationFailure(result)) {
      settings.connectionStatus = 'disconnected';
      settings.lastConnectionError = log.errorMessage;
      settings.lastHealthCheckedAt = new Date();
      await this.settingsRepo.save(settings);
    }

    return {
      success: false,
      status: 'failed',
      message: log.errorMessage,
      messageLogId: log.id,
    };
  }

  private async getLatestTest(settingsId: string): Promise<LatestWhatsappTest | null> {
    const rows = await this.dataSource.query(
      `SELECT id,
              recipient_phone AS "recipientPhone",
              COALESCE(response_payload->>'delivery_status', status) AS status,
              response_payload->>'message_id' AS "messageId",
              error_message AS "errorMessage",
              created_at AS "createdAt",
              COALESCE(
                NULLIF(response_payload->>'delivery_time', '')::timestamptz,
                sent_at,
                created_at
              ) AS "updatedAt"
       FROM message_logs
       WHERE trigger_event = 'admin_test'
         AND response_payload->>'whatsapp_settings_id' = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [settingsId],
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0] as Record<string, unknown>;
    const status = this.parseTestDeliveryStatus(row.status);
    if (!status) return null;
    return {
      id: String(row.id),
      recipientPhone: typeof row.recipientPhone === 'string' ? row.recipientPhone : null,
      status,
      messageId: typeof row.messageId === 'string' ? row.messageId : null,
      errorMessage: typeof row.errorMessage === 'string' ? row.errorMessage : null,
      createdAt: row.createdAt as Date | string,
      updatedAt: row.updatedAt as Date | string,
    };
  }

  private parseTestDeliveryStatus(value: unknown): WhatsappTestDeliveryStatus | null {
    return typeof value === 'string'
      && ['pending', 'accepted', 'sent', 'delivered', 'read', 'failed'].includes(value)
      ? value as WhatsappTestDeliveryStatus
      : null;
  }

  private isAuthenticationFailure(result: ApiCallResult): boolean {
    return result.httpStatus === 401 || result.providerErrorCode === 190;
  }

  // ─── Send Message (via Processor) ─────────────────────────────────────────

  async sendMessage(
    recipientPhone: string,
    message: string,
    options?: {
      recipientUserId?: string;
      templateId?: string;
      triggerEvent?: string;
      tenantId?: string;
    },
  ): Promise<{ success: boolean; messageLogId: string | null; savedMessageId?: string | null }> {
    // ✅ FIX CRITICAL: فلترة حسب التاجر
    const where = this.settingsWhere(options?.tenantId);

    const settings = await this.settingsRepo.findOne({ where });

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

      log.status = result.success ? MessageStatus.SENT : MessageStatus.FAILED;
      log.attempts = 1;
      log.sentAt = result.success ? new Date() : undefined;
      log.responsePayload = result.response;
      log.errorMessage = result.error;
      await this.messageLogRepo.save(log);

      // ✅ إنشاء/تحديث conversation في admin inbox عند نجاح الإرسال
      let savedMessageId: string | null = null;
      if (result.success && settings.phoneNumberId) {
        try {
          const saved = await this.createOrUpdateAdminConversation(
            settings.phoneNumberId,
            recipientPhone,
            message,
            getJsonString(result.response, 'message_id'),
          );
          savedMessageId = saved?.messageId || null;
        } catch (e) {
          this.logger.warn(`⚠️ Failed to create admin conversation: ${(e as Error).message}`);
        }
      }

      return { success: result.success, messageLogId: log.id, savedMessageId };
    } catch (err) {
      await this.messageLogRepo.update(log.id, {
        status: MessageStatus.FAILED,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        attempts: 1,
      });
      return { success: false, messageLogId: log.id };
    }
  }

  // ─── Admin Conversation (Private) ───────────────────────────────────────────

  /**
   * ✅ ينشئ أو يُحدّث conversation في admin inbox عند إرسال رسالة إدارية
   * يبحث عن channel بـ phoneNumberId الأدمن ثم ينشئ conversation + message
   */
  private async createOrUpdateAdminConversation(
    phoneNumberId: string,
    recipientPhone: string,
    messageContent: string,
    externalMessageId?: string,
  ): Promise<{ conversationId: string; messageId: string } | null> {
    // قناة الإدارة المطابقة فقط. لا يجوز إلحاق محادثة إدارية بمتجر عشوائي.
    const [channel] = await this.dataSource.query(
      `SELECT id, store_id FROM channels
       WHERE whatsapp_phone_number_id = $1 AND is_admin_channel = true
       LIMIT 1`,
      [phoneNumberId],
    );

    if (!channel) {
      this.logger.warn(`No WhatsApp channel found — cannot create admin conversation for ${recipientPhone}`);
      return null;
    }

    // 2. احصل على tenant_id من store
    const [store] = await this.dataSource.query(
      `SELECT tenant_id FROM stores WHERE id = $1 LIMIT 1`,
      [channel.store_id],
    );

    if (!store?.tenant_id) {
      this.logger.debug(`No tenant found for store ${channel.store_id} — skipping`);
      return null;
    }

    const tenantId: string = store.tenant_id;
    const now = new Date();

    // 3. ابحث عن conversation موجودة (OUTBOUND للمستلم نفسه)
    const [existingConv] = await this.dataSource.query(
      `SELECT id FROM conversations
       WHERE channel_id = $1
         AND customer_phone = $2
         AND status IN ('open','pending','assigned')
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [channel.id, recipientPhone],
    );

    let conversationId: string;

    if (existingConv) {
      // 4a. تحديث last_message_at
      conversationId = existingConv.id;
      await this.dataSource.query(
        `UPDATE conversations SET last_message_at = $1, messages_count = messages_count + 1 WHERE id = $2`,
        [now, conversationId],
      );
    } else {
      // 4b. إنشاء conversation جديدة
      const [newConv] = await this.dataSource.query(
        `INSERT INTO conversations
           (id, tenant_id, channel_id, customer_phone, customer_external_id,
            status, handler, messages_count, last_message_at, ai_context, metadata, tags, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $3,
            'open', 'human', 1, $4, '{}', '{}', '{}', $4, $4)
         RETURNING id`,
        [tenantId, channel.id, recipientPhone, now],
      );
      conversationId = newConv.id;
    }

    // 5. أضف الرسالة وأرجع الـ ID
    const [newMsg] = await this.dataSource.query(
      `INSERT INTO messages
         (id, tenant_id, conversation_id, direction, type, status, sender,
          external_id, content, metadata, delivered_at, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'outbound', 'text', 'sent', 'agent',
          $3, $4, '{}', $5, $5, $5)
       RETURNING id, content, sender, direction, status, created_at`,
      [tenantId, conversationId, externalMessageId || null, messageContent, now],
    );

    this.logger.log(`✅ Admin conversation created/updated: ${conversationId}`);
    return { conversationId, messageId: newMsg.id };
  }

  // ─── API Call (Private) ───────────────────────────────────────────────────

  /**
   * ✅ FIX [TS2339]: data is validated before nested fields are read.
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
        const url = `${this.graphApiBaseUrl()}/${settings.phoneNumberId}/messages`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: this.formatMetaRecipient(to),
            type: 'text',
            text: { body: message },
          }),
        });

        // ✅ FIX [TS2339]: read the provider error through the validated record.
        const data = asJsonRecord(await resp.json()) ?? {};

        if (!resp.ok) {
          const providerError = asJsonRecord(data.error);
          const errorMsg = getJsonString(providerError, 'message') ?? `HTTP ${resp.status}`;
          const providerErrorCode = typeof providerError?.code === 'number'
            ? providerError.code
            : undefined;
          return {
            success: false,
            response: data,
            error: errorMsg,
            httpStatus: resp.status,
            providerErrorCode,
          };
        }
        const firstMessage = Array.isArray(data.messages)
          ? asJsonRecord(data.messages[0])
          : undefined;
        const messageId = getJsonString(firstMessage, 'id');
        return {
          success: true,
          response: messageId ? { ...data, message_id: messageId } : data,
        };
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

        const data = asJsonRecord(await resp.json()) ?? {};
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
  // ─────────────────────────────────────────────────────────────────────────
  // 📬 صندوق رسائل واتساب الإدارية
  //
  //  يقرأ من message_logs — مصدر واحد واضح للبيانات الإدارية:
  //  - direction='inbound'  → رسائل واردة من العملاء (trigger_event='inbound')
  //  - direction='outbound' → إشعارات صادرة من النظام
  //
  //  الفلاتر:
  //  - status: 'inbound' | 'sent' | 'failed' | 'pending' | '' (الكل)
  //  - phone:  بحث جزئي بالأرقام فقط
  //
  //  الـ Pagination يتم في قاعدة البيانات (LIMIT/OFFSET) — آمن مع الآلاف
  // ─────────────────────────────────────────────────────────────────────────
  async getMessageLogs(opts: {
    page:    number;
    limit:   number;
    status?: string;
    phone?:  string;
  }): Promise<{
    data: Array<{
      id:             string;
      recipientPhone: string | null;
      content:        string | null;
      direction:      'inbound' | 'outbound';
      status:         string;
      attempts:       number;
      errorMessage:   string | null;
      sentAt:         Date | null;
      createdAt:      Date;
      triggerEvent:   string | null;
    }>;
    total:  number;
    page:   number;
    limit:  number;
  }> {
    try {
      const offset     = (opts.page - 1) * opts.limit;
      const params: unknown[] = [];
      const conditions: string[] = [`ml.channel = 'whatsapp'`];

      // ── فلتر الاتجاه / الحالة ─────────────────────────────────────────────
      if (opts.status === 'inbound') {
        conditions.push(`ml.direction = 'inbound'`);
      } else if (opts.status === 'sent') {
        conditions.push(`ml.direction = 'outbound' AND ml.status = 'sent'`);
      } else if (opts.status === 'failed') {
        conditions.push(`ml.status = 'failed'`);
      } else if (opts.status === 'pending') {
        conditions.push(`ml.direction = 'outbound' AND ml.status IN ('pending','retrying')`);
      }
      // '' → الكل بدون فلتر إضافي

      // ── فلتر رقم الهاتف ───────────────────────────────────────────────────
      if (opts.phone) {
        const digits = opts.phone.replace(/\D/g, '');
        if (digits) {
          params.push(`%${digits}%`);
          conditions.push(
            `REGEXP_REPLACE(COALESCE(ml.recipient_phone,''), '[^0-9]', '', 'g') LIKE $${params.length}`,
          );
        }
      }

      const where = conditions.join(' AND ');

      // ── COUNT ──────────────────────────────────────────────────────────────
      const countResult = await this.dataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM message_logs ml WHERE ${where}`,
        params,
      );
      const total = parseInt(countResult[0]?.total ?? '0', 10);

      // ── DATA — pagination in DB ────────────────────────────────────────────
      params.push(opts.limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const rows = await this.dataSource.query<MessageHistoryRow[]>(
        `SELECT
           ml.id               AS id,
           ml.recipient_phone  AS "recipientPhone",
           ml.content          AS content,
           ml.direction        AS direction,
           ml.status           AS status,
           ml.attempts         AS attempts,
           ml.error_message    AS "errorMessage",
           ml.sent_at          AS "sentAt",
           ml.created_at       AS "createdAt",
           ml.trigger_event    AS "triggerEvent"
         FROM message_logs ml
         WHERE ${where}
         ORDER BY ml.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      return {
        data: rows.map((r) => ({
          id:             String(r.id),
          recipientPhone: r.recipientPhone || null,
          content:        r.content || null,
          direction:      r.direction === 'inbound' ? 'inbound' : 'outbound',
          status:         String(r.status),
          attempts:       Number(r.attempts) || 0,
          errorMessage:   r.errorMessage || null,
          sentAt:         r.sentAt ? new Date(r.sentAt) : null,
          createdAt:      new Date(r.createdAt),
          triggerEvent:   r.triggerEvent || null,
        })),
        total,
        page:  opts.page,
        limit: opts.limit,
      };
    } catch (err) {
      this.logger.error('Failed to fetch WhatsApp message logs', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
      return { data: [], total: 0, page: opts.page, limit: opts.limit };
    }
  }


  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private settingsWhere(tenantId?: string): FindOptionsWhere<WhatsappSettings> {
    return tenantId ? { tenantId } : { tenantId: IsNull() };
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
    return token ? '•••••••• (محفوظ)' : 'غير محفوظ';
  }

  private formatMetaRecipient(phone: string): string {
    let normalized = phone.replace(/\D/g, '');
    if (normalized.startsWith('00') && normalized.length > 10) normalized = normalized.slice(2);
    if (normalized.startsWith('05') && normalized.length === 10) return `966${normalized.slice(1)}`;
    if (normalized.startsWith('5') && normalized.length === 9) return `966${normalized}`;
    return normalized;
  }

  private toSafeSettings(
    settings: WhatsappSettings,
    latestTest: LatestWhatsappTest | null,
  ): SafeWhatsappSettings {
    const { accessTokenEncrypted, webhookVerifyToken, ...rest } = settings;
    return {
      ...rest,
      hasAccessToken: Boolean(accessTokenEncrypted),
      hasWebhookVerifyToken: Boolean(webhookVerifyToken),
      maskedToken: this.maskToken(accessTokenEncrypted),
      latestTest,
    };
  }

  private graphApiBaseUrl(): string {
    const version = this.configService.get<string>('whatsapp.apiVersion', 'v21.0');
    return `https://graph.facebook.com/${version}`;
  }

  private safeConnectionError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown connection error';
    return message.slice(0, 500);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[char] as string);
  }
}
