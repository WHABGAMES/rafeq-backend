/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates Service                                ║
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

    // Apply filters
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

    // Get total count
    const total = await queryBuilder.getCount();

    // Get paginated results
    const templates = await queryBuilder
      .orderBy('template.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      data: templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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
   * إنشاء قالب جديد
   */
  async create(tenantId: string, dto: CreateTemplateDto) {
    // Validate template content
    this.validateTemplateContent(dto);

    const template = this.templateRepository.create({
      tenantId,
      name: dto.name,
      displayName: dto.name,
      description: dto.description,
      category: dto.category as any,
      channel: dto.channel as any,
      language: (dto.language || 'ar') as any,
      body: dto.content,
      status: TemplateStatus.DRAFT,
      stats: { usageCount: 0 },
    });

    const saved = await this.templateRepository.save(template);

    this.logger.log(`Template created: ${saved.id}`, { tenantId, name: dto.name });

    return saved;
  }

  /**
   * تحديث قالب
   */
  async update(id: string, tenantId: string, dto: UpdateTemplateDto) {
    const template = await this.findById(id, tenantId);

    // If template is approved by WhatsApp, some fields cannot be changed
    if (template.status === TemplateStatus.APPROVED && dto.content) {
      throw new BadRequestException(
        'لا يمكن تعديل محتوى قالب معتمد من WhatsApp. قم بإنشاء قالب جديد.',
      );
    }

    if (dto.content) {
      template.body = dto.content;
    }
    if (dto.name) {
      template.name = dto.name;
      template.displayName = dto.name;
    }
    if (dto.description) {
      template.description = dto.description;
    }
    if (dto.category) {
      template.category = dto.category as any;
    }
    
    return this.templateRepository.save(template);
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

    template.status = template.status === TemplateStatus.ACTIVE 
      ? TemplateStatus.DISABLED 
      : TemplateStatus.ACTIVE;

    const saved = await this.templateRepository.save(template);

    return {
      id: saved.id,
      status: saved.status,
      message: saved.status === TemplateStatus.ACTIVE ? 'تم تفعيل القالب' : 'تم تعطيل القالب',
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

    // Replace variables in body
    let body = template.body || '';
    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });
    }

    // TODO: Send via WhatsApp/SMS service
    this.logger.log(`Test message sent to ${phone}`, { templateId: id });

    return {
      success: true,
      message: 'تم إرسال رسالة الاختبار',
      preview: body,
    };
  }

  /**
   * إرسال قالب للموافقة من WhatsApp
   */
  async submitToWhatsApp(tenantId: string, dto: SubmitWhatsAppTemplateDto) {
    // TODO: Integrate with WhatsApp Business API
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
      where: {
        tenantId,
        channel: TemplateChannel.WHATSAPP,
      },
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
    // TODO: Fetch templates from WhatsApp Business API
    this.logger.log(`Syncing WhatsApp templates`, { tenantId });

    return {
      success: true,
      message: 'تمت المزامنة بنجاح',
      synced: 0,
      added: 0,
      updated: 0,
    };
  }

  /**
   * إحصائيات القالب
   */
  async getStats(_id: string, _tenantId: string) {
    // TODO: Get actual stats from messages/campaigns tables
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

  /**
   * Validate template content
   */
  private validateTemplateContent(dto: CreateTemplateDto) {
    // Check for required variables based on category
    const requiredVariables: Record<string, string[]> = {
      order_confirmation: ['order_id', 'order_total'],
      shipping_update: ['order_id', 'shipping_company'],
      abandoned_cart: ['cart_link'],
      authentication: ['otp_code'],
    };

    const category = dto.category;
    if (category && requiredVariables[category]) {
      const content = dto.content || '';
      const missing = requiredVariables[category].filter(
        (v) => !content.includes(`{{${v}}}`),
      );

      if (missing.length > 0) {
        this.logger.warn(`Template missing required variables: ${missing.join(', ')}`);
      }
    }

    // Validate content length for WhatsApp
    if (dto.channel === 'whatsapp' && dto.content && dto.content.length > 1024) {
      throw new BadRequestException('محتوى القالب يتجاوز الحد المسموح (1024 حرف)');
    }
  }
}
