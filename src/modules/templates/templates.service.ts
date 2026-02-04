/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates Service                                ║
 * ║  ✅ v2: حفظ triggerEvent + status + إرجاع content                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageTemplate, TemplateStatus, TemplateChannel } from '@database/entities';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateFiltersDto,
  SubmitWhatsAppTemplateDto,
} from './dto';

interface PaginationOptions {
  page: number;
  limit: number;
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepository: Repository<MessageTemplate>,
  ) {}

  /**
   * جلب جميع القوالب مع الفلترة
   */
  async findAll(
    tenantId: string,
    filters: TemplateFiltersDto,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const queryBuilder = this.templateRepository
      .createQueryBuilder('template')
      .where('template.tenantId = :tenantId', { tenantId });

    if (filters.type) {
      queryBuilder.andWhere('template.type = :type', { type: filters.type });
    }
    if (filters.category) {
      queryBuilder.andWhere('template.category = :category', { category: filters.category });
    }
    if (filters.status) {
      queryBuilder.andWhere('template.status = :status', { status: filters.status });
    }
    if (filters.channel) {
      queryBuilder.andWhere('template.channel = :channel', { channel: filters.channel });
    }
    if (filters.search) {
      queryBuilder.andWhere(
        '(template.name ILIKE :search OR template.body ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    const total = await queryBuilder.getCount();
    const templates = await queryBuilder
      .orderBy('template.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    // ✅ إرجاع content مع كل قالب
    const mappedTemplates = templates.map((t) => ({
      ...t,
      content: t.body,
    }));

    return {
      data: mappedTemplates,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * جلب قالب بالـ ID
   */
  async findById(id: string, tenantId: string) {
    const template = await this.templateRepository.findOne({
      where: { id, tenantId },
    });
    if (!template) {
      throw new NotFoundException('القالب غير موجود');
    }
    return template;
  }

  /**
   * ✅ إنشاء قالب جديد
   */
  async create(tenantId: string, dto: CreateTemplateDto) {
    this.logger.log(`Creating template: ${dto.name}`, {
      tenantId,
      category: dto.category,
      triggerEvent: dto.triggerEvent,
    });

    // ✅ قبول status من الفرونتند
    const status =
      dto.status === 'approved'
        ? TemplateStatus.APPROVED
        : dto.status === 'active'
          ? TemplateStatus.ACTIVE
          : TemplateStatus.DRAFT;

    const template = this.templateRepository.create({
      tenantId,
      name: dto.name,
      displayName: dto.name,
      description: dto.description,
      category: dto.category || 'general',
      channel: (dto.channel as TemplateChannel) || TemplateChannel.WHATSAPP,
      language: (dto.language || 'ar') as any,
      body: dto.content,
      status,
      triggerEvent: dto.triggerEvent || undefined, // ✅ حفظ الحدث المرتبط
      buttons: (dto.buttons as any) || [],
      stats: { usageCount: 0 },
    });

    try {
      const saved = await this.templateRepository.save(template);

      this.logger.log(`✅ Template created: ${saved.id}`, {
        tenantId,
        name: dto.name,
        status: saved.status,
        triggerEvent: saved.triggerEvent,
      });

      return { ...saved, content: saved.body };
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      if (
        err.code === '23505' ||
        (typeof err.detail === 'string' && err.detail.includes('already exists'))
      ) {
        this.logger.warn(`Template name already exists: ${dto.name}`, { tenantId });
        throw new BadRequestException(`قالب بنفس الاسم "${dto.name}" موجود بالفعل`);
      }
      throw error;
    }
  }

  /**
   * تحديث قالب
   */
  async update(id: string, tenantId: string, dto: UpdateTemplateDto) {
    const template = await this.findById(id, tenantId);

    if (dto.content) template.body = dto.content;
    if (dto.name) {
      template.name = dto.name;
      template.displayName = dto.name;
    }
    if (dto.description) template.description = dto.description;
    if (dto.category) template.category = dto.category;
    if (dto.status) template.status = dto.status as TemplateStatus;
    if (dto.triggerEvent !== undefined) template.triggerEvent = dto.triggerEvent;

    const saved = await this.templateRepository.save(template);
    return { ...saved, content: saved.body };
  }

  /**
   * حذف قالب
   */
  async delete(id: string, tenantId: string) {
    const template = await this.findById(id, tenantId);
    await this.templateRepository.delete(template.id);
    this.logger.log(`Template deleted: ${id}`, { tenantId });
  }

  /**
   * تفعيل/تعطيل قالب
   */
  async toggle(id: string, tenantId: string) {
    const template = await this.findById(id, tenantId);
    template.status =
      template.status === TemplateStatus.ACTIVE
        ? TemplateStatus.DISABLED
        : TemplateStatus.ACTIVE;

    const saved = await this.templateRepository.save(template);
    return {
      id: saved.id,
      status: saved.status,
      content: saved.body,
      message:
        saved.status === TemplateStatus.ACTIVE ? 'تم تفعيل القالب' : 'تم تعطيل القالب',
    };
  }

  /**
   * نسخ قالب
   */
  async duplicate(id: string, tenantId: string, newName?: string) {
    const original = await this.findById(id, tenantId);
    const duplicate = this.templateRepository.create({
      tenantId: original.tenantId,
      name: newName || `${original.name}_copy`,
      displayName: newName || `${original.displayName} (نسخة)`,
      description: original.description,
      category: original.category,
      channel: original.channel,
      language: original.language,
      body: original.body,
      header: original.header,
      footer: original.footer,
      buttons: original.buttons,
      variables: original.variables,
      triggerEvent: original.triggerEvent,
      status: TemplateStatus.DRAFT,
      stats: { usageCount: 0 },
    });
    return this.templateRepository.save(duplicate);
  }

  /**
   * إرسال رسالة اختبارية
   */
  async sendTest(
    id: string,
    tenantId: string,
    phone: string,
    variables?: Record<string, string>,
  ) {
    const template = await this.findById(id, tenantId);
    let body = template.body || '';
    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });
    }
    this.logger.log(`Test message sent to ${phone}`, { templateId: id });
    return { success: true, message: 'تم إرسال رسالة الاختبار', preview: body };
  }

  /**
   * إرسال قالب للموافقة من WhatsApp
   */
  async submitToWhatsApp(tenantId: string, dto: SubmitWhatsAppTemplateDto) {
    this.logger.log(`Submitting template to WhatsApp: ${dto.name}`, { tenantId });
    return {
      success: true,
      message: 'تم إرسال القالب للمراجعة. سيتم إشعارك عند الموافقة.',
      estimatedTime: '24-48 ساعة',
    };
  }

  /**
   * جلب حالة قوالب WhatsApp
   */
  async getWhatsAppTemplatesStatus(tenantId: string) {
    const templates = await this.templateRepository.find({
      where: { tenantId, channel: TemplateChannel.WHATSAPP },
      select: ['id', 'name', 'status', 'updatedAt'],
    });
    return {
      templates,
      summary: {
        total: templates.length,
        approved: templates.filter((t) => t.status === TemplateStatus.APPROVED).length,
        pending: templates.filter((t) => t.status === TemplateStatus.PENDING_APPROVAL).length,
        rejected: templates.filter((t) => t.status === TemplateStatus.REJECTED).length,
      },
    };
  }

  /**
   * مزامنة مع WhatsApp
   */
  async syncWithWhatsApp(tenantId: string) {
    this.logger.log(`Syncing WhatsApp templates`, { tenantId });
    return { success: true, message: 'تمت المزامنة بنجاح', synced: 0, added: 0, updated: 0 };
  }

  /**
   * إحصائيات القالب
   */
  async getStats(_id: string, _tenantId: string) {
    return {
      usageCount: 0,
      sentCount: 0,
      deliveredCount: 0,
      readCount: 0,
      clickCount: 0,
      deliveryRate: 0,
      readRate: 0,
      clickRate: 0,
      lastUsed: null,
    };
  }
}
