/**
 * NotificationService — Template-based Notification System
 * Fixed: 2026-02-22
 *
 * FIX [TS6133]: Removed unused MessageChannel import
 * FIX [TS6138]: Removed unused WhatsappSettingsService injection
 *   — sending is delegated to NotificationProcessor via BullMQ queue
 * FIX [500-BUG]: getAllTemplates — wrapped in try/catch with InternalServerErrorException
 *   for better error visibility and logging
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
// ✅ FIX [TS6133]: MessageChannel removed (not used in service logic)
import { MessageTemplate, TriggerEvent, MessageLanguage } from '../entities/message-template.entity';

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

// ✅ FIX [TS6138]: No WhatsappSettingsService here
// Sending happens in NotificationProcessor which injects WhatsappSettingsService
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly loginUrl = process.env.FRONTEND_URL || 'https://app.rafeq.ai';

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,
  ) {}

  // ─── Event-driven Send ────────────────────────────────────────────────────

  /**
   * يُضاف job للـ queue — NotificationProcessor هو من يُرسل فعليًا
   * @param event TriggerEvent enum value
   * @param recipientPhone رقم الهاتف بصيغة دولية (e.g. +966501234567)
   */
  async sendByTriggerEvent(
    event: TriggerEvent,
    recipientPhone: string,
    variables: TemplateVariables,
    options?: {
      recipientUserId?: string;
      recipientEmail?: string;
      language?: MessageLanguage;
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
    options?: { recipientUserId?: string; recipientEmail?: string },
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
      },
      { attempts: 3 },
    );

    return { success: true, jobId: job.id as string };
  }

  // ─── Template CRUD ────────────────────────────────────────────────────────

  async createTemplate(data: Partial<MessageTemplate>, adminId: string): Promise<MessageTemplate> {
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

    // ✅ حفظ نسخة سابقة في التاريخ قبل التعديل
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

  /**
   * [FIX 500-BUG]: أضفنا try/catch مع InternalServerErrorException
   * يكشف الخطأ الحقيقي في الـ logs بدلاً من إخفائه
   * السبب الأكثر احتمالاً للـ 500:
   *   - جدول message_templates غير موجود في DB الإنتاج (migration لم تُشغَّل)
   *   - أو migration AddTemplateStatusConstraint أفسدت قاعدة البيانات
   */
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
        `فشل تحميل القوالب من قاعدة البيانات: ${errorMsg}. ` +
        'تأكد من تشغيل: npm run migration:run',
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

  /**
   * يستبدل {{variable}} بالقيم الفعلية في محتوى القالب
   */
  injectVariables(content: string, variables: TemplateVariables): string {
    let result = content;

    const merged: TemplateVariables = {
      login_url: this.loginUrl,
      ...variables,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    // ✅ إزالة المتغيرات غير المحلولة — لا تظهر للمستخدم
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  previewTemplate(content: string, variables: TemplateVariables): string {
    return this.injectVariables(content, variables);
  }
}
