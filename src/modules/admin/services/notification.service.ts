import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { MessageTemplate, TriggerEvent, MessageChannel, MessageLanguage } from '../entities/message-template.entity';
import { WhatsappSettingsService } from './whatsapp-settings.service';

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
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly loginUrl = process.env.FRONTEND_URL || 'https://app.rafeq.ai';

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,

    private readonly whatsappService: WhatsappSettingsService,
  ) {}

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

    // Find active template for event
    const template = await this.templateRepo.findOne({
      where: {
        triggerEvent: event,
        isActive: true,
        language: lang,
      },
    });

    if (!template) {
      this.logger.warn(`No active template for event ${event} / lang ${lang}`);
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

  async sendManual(
    templateId: string,
    recipientPhone: string,
    variables: TemplateVariables,
    options?: { recipientUserId?: string; recipientEmail?: string },
  ): Promise<{ success: boolean; jobId: string }> {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template) throw new NotFoundException(`Template ${templateId} not found`);

    const content = this.injectVariables(template.content, variables);

    const job = await this.notificationQueue.add(
      'send-notification',
      {
        templateId,
        content,
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

  // ─── Template CRUD ───────────────────────────────────────────────────────────

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

    // Save version to history
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
    return this.templateRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getTemplateById(id: string): Promise<MessageTemplate> {
    const t = await this.templateRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException(`Template ${id} not found`);
    return t;
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.templateRepo.delete(id);
  }

  // ─── Variable injection ──────────────────────────────────────────────────────

  injectVariables(content: string, variables: TemplateVariables): string {
    let result = content;

    const defaults: TemplateVariables = {
      login_url: this.loginUrl,
    };

    const merged = { ...defaults, ...variables };

    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    // Remove any remaining unresolved variables
    result = result.replace(/\{\{[^}]+\}\}/g, '');

    return result;
  }

  previewTemplate(content: string, variables: TemplateVariables): string {
    return this.injectVariables(content, variables);
  }
}
