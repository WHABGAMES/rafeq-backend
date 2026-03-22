/**
 * NotificationService — Admin Notification Template System
 *
 * FIX [TABLE-AUTO-CREATE]: onModuleInit() creates admin_notification_templates
 *   automatically on every app startup — no manual migration:run needed.
 *   Uses IF NOT EXISTS → 100% idempotent and safe.
 *
 * FIX [TABLE-CONFLICT]: Renamed from 'message_templates' to
 *   'admin_notification_templates' — the merchant platform uses
 *   'message_templates' with a different schema (body, status, tenantId)
 *   which caused: column "content" does not exist
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository, DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import {
  MessageTemplate,
  TriggerEvent,
  MessageLanguage,
} from '../entities/message-template.entity';

export interface TemplateVariables {
  merchant_name?: string;
  email?: string;
  login_url?: string;
  temporary_password?: string;
  plan_name?: string;
  expiry_date?: string;
  payment_amount?: string;
  [key: string]: string | undefined;
}

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private readonly loginUrl = process.env.FRONTEND_URL || 'https://app.rafeq.ai';

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─── Auto-create table on startup ────────────────────────────────────────
  // Runs BEFORE any HTTP request — guarantees table exists
  async onModuleInit(): Promise<void> {
    try {
      // Step 1: Create table (IF NOT EXISTS — safe to run multiple times)
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS admin_notification_templates (
          id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
          name        VARCHAR(255) NOT NULL,
          trigger_event VARCHAR(100) NOT NULL,
          channel     VARCHAR(20)  NOT NULL DEFAULT 'whatsapp',
          language    VARCHAR(5)   NOT NULL DEFAULT 'ar',
          content     TEXT         NOT NULL,
          subject     VARCHAR(500),
          is_active   BOOLEAN      NOT NULL DEFAULT true,
          version_history JSONB    NOT NULL DEFAULT '[]',
          version     INT          NOT NULL DEFAULT 1,
          created_by  UUID         NOT NULL,
          updated_by  UUID,
          created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);

      // Step 2: Create indexes (IF NOT EXISTS — safe)
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_notif_event_channel_lang
          ON admin_notification_templates (trigger_event, channel, language, is_active)
      `);

      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_admin_notif_active
          ON admin_notification_templates (is_active)
      `);

      // Step 3: Seed default templates — only if table is empty
      await this.dataSource.query(`
        INSERT INTO admin_notification_templates
          (name, trigger_event, channel, language, content, created_by)
        SELECT name, trigger_event, channel, language, content, created_by
        FROM (VALUES
          (
            'مرحبا بالتاجر الجديد',
            'NEW_MERCHANT_REGISTERED', 'whatsapp', 'ar',
            'مرحبًا {{merchant_name}} 👋

تم إنشاء حسابك في منصة رفيق AI بنجاح.

بيانات الدخول:
📧 البريد: {{email}}
🔑 كلمة المرور المؤقتة: {{temporary_password}}

🔗 رابط الدخول:
{{login_url}}

فريق رفيق يتمنى لك تجربة ناجحة 🚀',
            '00000000-0000-0000-0000-000000000000'::UUID
          ),
          (
            'Welcome New Merchant',
            'NEW_MERCHANT_REGISTERED', 'whatsapp', 'en',
            'Hello {{merchant_name}} 👋

Your account on Rafeq AI has been created successfully.

Login Details:
📧 Email: {{email}}
🔑 Temp Password: {{temporary_password}}

🔗 Login URL: {{login_url}}

Rafeq Team 🚀',
            '00000000-0000-0000-0000-000000000000'::UUID
          ),
          (
            'اشتراك على وشك الانتهاء',
            'SUBSCRIPTION_EXPIRING', 'whatsapp', 'ar',
            'مرحبًا {{merchant_name}} 👋

اشتراكك في خطة {{plan_name}} سينتهي في {{expiry_date}}.

لتجنب انقطاع الخدمة جدد اشتراكك:
{{login_url}}

فريق رفيق AI 💙',
            '00000000-0000-0000-0000-000000000000'::UUID
          ),
          (
            'تم إيقاف الحساب',
            'ACCOUNT_SUSPENDED', 'whatsapp', 'ar',
            'مرحبًا {{merchant_name}} 👋

تم إيقاف حسابك في منصة رفيق AI.

للاستفسار تواصل مع الدعم الفني.

فريق رفيق AI',
            '00000000-0000-0000-0000-000000000000'::UUID
          ),
          (
            'تم استلام الدفعة',
            'PAYMENT_RECEIVED', 'whatsapp', 'ar',
            'مرحبًا {{merchant_name}} 👋

تم استلام دفعتك بنجاح ✅

المبلغ: {{payment_amount}}
الخطة: {{plan_name}}

شكراً، فريق رفيق AI 💙',
            '00000000-0000-0000-0000-000000000000'::UUID
          )
        ) AS v(name, trigger_event, channel, language, content, created_by)
        WHERE NOT EXISTS (
          SELECT 1 FROM admin_notification_templates LIMIT 1
        )
      `);

      this.logger.log('✅ admin_notification_templates: ready');
    } catch (err) {
      // Log but don't crash the app — table might already exist from a previous run
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[onModuleInit] admin_notification_templates setup failed: ${msg}`);
    }
  }

  // ─── Event-driven Send ────────────────────────────────────────────────────

  async sendByTriggerEvent(
    event: TriggerEvent,
    recipientPhone: string,
    variables: TemplateVariables,
    options?: {
      recipientUserId?: string;
      recipientEmail?: string;
      language?: MessageLanguage;
      tenantId?: string;
    },
  ): Promise<void> {
    const lang = options?.language || MessageLanguage.AR;

    const template = await this.templateRepo.findOne({
      where: { triggerEvent: event, isActive: true, language: lang },
    });

    if (!template) {
      this.logger.warn(`No active template for event=${event} lang=${lang}`);
      return;
    }

    await this.notificationQueue.add(
      'send-notification',
      {
        templateId: template.id,
        content: this.injectVariables(template.content, variables),
        channel: template.channel,
        recipientPhone,
        recipientEmail: options?.recipientEmail,
        recipientUserId: options?.recipientUserId,
        triggerEvent: event,
        tenantId: options?.tenantId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  // ─── Manual Send ──────────────────────────────────────────────────────────

  async sendManual(
    templateId: string,
    recipientPhone: string,
    variables: TemplateVariables,
    options?: { recipientUserId?: string; recipientEmail?: string; tenantId?: string },
  ): Promise<{ success: boolean; jobId: string }> {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template) throw new NotFoundException(`Template ${templateId} not found`);

    const job = await this.notificationQueue.add(
      'send-notification',
      {
        templateId,
        content: this.injectVariables(template.content, variables),
        channel: template.channel,
        recipientPhone,
        recipientEmail: options?.recipientEmail,
        recipientUserId: options?.recipientUserId,
        triggerEvent: TriggerEvent.CUSTOM_MANUAL_SEND,
        tenantId: options?.tenantId,
      },
      { attempts: 3 },
    );

    return { success: true, jobId: job.id as string };
  }

  // ─── Template CRUD ────────────────────────────────────────────────────────

  async createTemplate(
    data: Partial<MessageTemplate>,
    adminId: string,
  ): Promise<MessageTemplate> {
    const template = this.templateRepo.create({
      ...data,
      createdBy: adminId,
      version: 1,
      versionHistory: [],
    });
    return this.templateRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<MessageTemplate>,
    adminId: string,
  ): Promise<MessageTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException(`Template ${id} not found`);

    template.versionHistory = [
      ...(template.versionHistory || []),
      {
        version: template.version,
        content: template.content,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId,
      },
    ];
    template.version++;
    template.updatedBy = adminId;
    Object.assign(template, data);

    return this.templateRepo.save(template);
  }

  async getAllTemplates(): Promise<MessageTemplate[]> {
    try {
      return await this.templateRepo.find({ order: { createdAt: 'DESC' } });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown DB error';
      this.logger.error(
        `[getAllTemplates] DB query failed: ${errorMsg}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new InternalServerErrorException(
        `فشل تحميل القوالب: ${errorMsg}`,
      );
    }
  }

  async getTemplateById(id: string): Promise<MessageTemplate> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return template;
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.templateRepo.delete(id);
  }

  // ─── Variable Injection ───────────────────────────────────────────────────

  injectVariables(content: string, variables: TemplateVariables): string {
    let result = content;
    const merged: TemplateVariables = { login_url: this.loginUrl, ...variables };

    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    // Remove any leftover unfilled variables
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  previewTemplate(content: string, variables: TemplateVariables): string {
    return this.injectVariables(content, variables);
  }
}
