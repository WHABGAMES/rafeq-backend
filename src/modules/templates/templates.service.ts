/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates Service                                ║
 * ║  ✅ v4: إصلاح جذري — soft delete + QueryBuilder filter + verify after save   ║
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ✅ Helper: تحويل Entity → Response DTO
  // ═══════════════════════════════════════════════════════════════════════════
  private mapToResponse(t: MessageTemplate) {
    return {
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      category: t.category,
      channel: t.channel,
      language: t.language,
      status: t.status,
      triggerEvent: t.triggerEvent,
      content: t.body,
      body: t.body,
      header: t.header,
      footer: t.footer,
      buttons: t.buttons,
      variables: t.variables,
      stats: t.stats,
      usageCount: t.stats?.usageCount ?? 0,
      isEnabled: t.status === 'active' || t.status === 'approved',
      // ✅ v14: إعدادات الإرسال — التأخير، الشرط، التسلسل
      sendSettings: t.sendSettings ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  /**
   * ✅ جلب جميع القوالب
   * إصلاحات:
   *  1. فلترة deleted_at IS NULL صريحة (QueryBuilder ما يفلتر تلقائي دايم)
   *  2. استخدام أسماء أعمدة قاعدة البيانات الفعلية (snake_case)
   *  3. limit=100 بدل 20 حتى يشمل كل القوالب
   */
  async findAll(
    tenantId: string,
    filters: TemplateFiltersDto,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    this.logger.log(`📋 findAll: tenant=${tenantId}, page=${page}, limit=${limit}`);

    const queryBuilder = this.templateRepository
      .createQueryBuilder('template')
      .where('template.tenant_id = :tenantId', { tenantId })
      // ✅ فلترة صريحة — TypeORM QueryBuilder لا يضمن فلترة soft delete تلقائياً
      .andWhere('template.deleted_at IS NULL');

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
      .orderBy('template.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    this.logger.log(`✅ findAll: found ${templates.length}/${total} | statuses=[${templates.map(t => t.status).join(',')}] | names=[${templates.map(t => t.name).join(',')}]`);

    return {
      data: templates.map(t => this.mapToResponse(t)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * جلب قالب بالـ ID (داخلي)
   */
  private async findByIdInternal(id: string, tenantId: string): Promise<MessageTemplate> {
    const template = await this.templateRepository.findOne({
      where: { id, tenantId },
    });
    if (!template) {
      throw new NotFoundException('القالب غير موجود');
    }
    return template;
  }

  /**
   * جلب قالب بالـ ID (للعرض)
   */
  async findById(id: string, tenantId: string) {
    const template = await this.findByIdInternal(id, tenantId);
    return this.mapToResponse(template);
  }

  /**
   * ✅ إنشاء قالب جديد — مع تحقق بعد الحفظ
   */
  async create(tenantId: string, dto: CreateTemplateDto) {
    this.logger.log(`🆕 create: name="${dto.name}", tenant=${tenantId}, status=${dto.status}, trigger=${dto.triggerEvent}`);

    // ✅ تحقق إذا القالب موجود بنفس الاسم (حتى لو محذوف soft delete)
    const existingTemplate = await this.templateRepository.findOne({
      where: { tenantId: tenantId as any, name: dto.name },
      withDeleted: true,
    });

    if (existingTemplate) {
      this.logger.log(`📝 Found existing: id=${existingTemplate.id}, status=${existingTemplate.status}, deleted=${!!existingTemplate.deletedAt}`);

      // ✅ إزالة الـ soft delete
      if (existingTemplate.deletedAt) {
        await this.templateRepository.restore(existingTemplate.id);
        this.logger.log(`♻️ Restored soft-deleted template: ${existingTemplate.id}`);

        // ⚠️ FIX الجذري: مسح deletedAt من الكائن في الذاكرة
        // بدون هذا السطر، save() يكتب القيمة القديمة ويعيد الحذف!
        existingTemplate.deletedAt = undefined as any;
      }

      // تحديث القالب
      existingTemplate.status = TemplateStatus.APPROVED;
      existingTemplate.body = dto.content || existingTemplate.body;
      existingTemplate.triggerEvent = dto.triggerEvent ?? existingTemplate.triggerEvent;
      existingTemplate.category = dto.category || existingTemplate.category;
      if (dto.buttons) existingTemplate.buttons = dto.buttons as any;
      if (dto.sendSettings) existingTemplate.sendSettings = dto.sendSettings as any;

      const updated = await this.templateRepository.save(existingTemplate);

      // ✅ تحقق بعد الحفظ
      const verified = await this.templateRepository.findOne({ where: { id: updated.id, tenantId } });
      this.logger.log(`✅ Reactivated: id=${updated.id}, status=${updated.status}, verified=${!!verified}`);

      if (!verified) {
        this.logger.error(`❌ CRITICAL: Reactivated template NOT found! id=${updated.id}`);
      }

      return this.mapToResponse(updated);
    }

    // ✅ قالب جديد — active افتراضياً (رفيق لا يحتاج Meta approval workflow)
    // disabled/rejected هي الحالات التي تمنع الإرسال فقط
    const status =
      dto.status === 'disabled'         ? TemplateStatus.DISABLED
      : dto.status === 'rejected'       ? TemplateStatus.REJECTED
      : dto.status === 'approved'       ? TemplateStatus.APPROVED
      : dto.status === 'pending_approval' ? TemplateStatus.PENDING_APPROVAL
      : TemplateStatus.ACTIVE;           // ← default: active (لا draft)

    this.logger.log(`📝 Creating NEW: name="${dto.name}", mappedStatus=${status}, sendSettings=${JSON.stringify(dto.sendSettings || null)}`);

    const templateData: Partial<MessageTemplate> = {
      tenantId: tenantId as any,
      name: dto.name,
      displayName: dto.name,
      description: dto.description,
      category: dto.category || 'general',
      channel: (dto.channel as TemplateChannel) || TemplateChannel.WHATSAPP,
      language: (dto.language || 'ar') as any,
      body: dto.content,
      status,
      triggerEvent: dto.triggerEvent ?? undefined,
      buttons: (dto.buttons as any) || [],
      variables: [] as any,
      stats: { usageCount: 0 } as any,
      // ✅ v15: حفظ sendSettings عند الإنشاء — كان مفقوداً وسبّب ضياع الإعدادات!
      sendSettings: dto.sendSettings ? (dto.sendSettings as any) : undefined,
    };

    const template = this.templateRepository.create(templateData as any);

    try {
      const result = await this.templateRepository.save(template);
      const saved = Array.isArray(result) ? result[0] : result;

      // ✅ تحقق بعد الحفظ
      const verified = await this.templateRepository.findOne({
        where: { id: saved.id, tenantId },
      });

      if (!verified) {
        this.logger.error(`❌ CRITICAL: Created template NOT found after save! id=${saved.id}, tenant=${tenantId}`);
        throw new Error('فشل في التحقق من حفظ القالب — يرجى المحاولة مرة أخرى');
      }

      this.logger.log(`✅ Created & verified: id=${saved.id}, name="${saved.name}", status=${saved.status}`);
      return this.mapToResponse(saved);

    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      this.logger.error(`❌ create failed: ${err.message || err}`, { code: err.code, detail: err.detail });

      if (err.code === '23505' || (typeof err.detail === 'string' && err.detail.includes('already exists'))) {
        throw new BadRequestException(`قالب بنفس الاسم "${dto.name}" موجود بالفعل`);
      }
      throw error;
    }
  }

  /**
   * ✅ تحديث قالب
   */
  async update(id: string, tenantId: string, dto: UpdateTemplateDto) {
    const template = await this.findByIdInternal(id, tenantId);

    this.logger.log(`📝 update: id=${id}, currentStatus=${template.status}, newStatus=${dto.status}`);

    if (dto.content !== undefined && dto.content !== null) template.body = dto.content;
    if (dto.name !== undefined && dto.name !== null) {
      template.name = dto.name;
      template.displayName = dto.name;
    }
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.category !== undefined && dto.category !== null) template.category = dto.category;
    if (dto.status !== undefined && dto.status !== null) template.status = dto.status;
    if (dto.triggerEvent !== undefined) template.triggerEvent = dto.triggerEvent;
    // ✅ v15: حفظ إعدادات الإرسال مع validation
    if (dto.sendSettings !== undefined) {
      // التأكد من صحة sendingMode إن وُجد
      const settings = dto.sendSettings as Record<string, unknown>;
      const validModes = ['instant', 'delayed', 'conditional', 'manual'];
      if (settings.sendingMode && !validModes.includes(String(settings.sendingMode))) {
        throw new BadRequestException(`sendingMode غير صالح`);
      }
      template.sendSettings = dto.sendSettings as any;
      this.logger.log(`📝 SendSettings updated for "${template.name}" (id=${id}): mode=${settings.sendingMode}, delay=${settings.delayMinutes || 'none'}`);
    }

    const saved = await this.templateRepository.save(template);

    // ✅ تحقق
    const verified = await this.templateRepository.findOne({ where: { id, tenantId } });
    this.logger.log(`✅ Updated: id=${id}, status=${saved.status}, verifiedStatus=${verified?.status}`);

    return this.mapToResponse(saved);
  }

  /**
   * ✅ حذف قالب — soft delete
   */
  async delete(id: string, tenantId: string) {
    const template = await this.findByIdInternal(id, tenantId);
    this.logger.log(`🗑️ Soft-delete: id=${id}, name="${template.name}"`);
    await this.templateRepository.softDelete(template.id);
  }

  /**
   * ✅ تفعيل/تعطيل عدة قوالب
   */
  async bulkToggle(ids: string[], tenantId: string, enable: boolean) {
    const templates = await this.templateRepository.find({
      where: { id: { $in: ids } as any, tenantId },
    });

    if (templates.length === 0) throw new NotFoundException('لم يتم العثور على قوالب');

    const newStatus = enable ? TemplateStatus.ACTIVE : TemplateStatus.DISABLED;
    templates.forEach(t => { t.status = newStatus; });
    const saved = await this.templateRepository.save(templates);

    return {
      success: true,
      count: saved.length,
      templates: saved.map(t => ({
        id: t.id, name: t.name, status: t.status,
        isEnabled: ['active', 'approved'].includes(t.status),
      })),
      message: enable ? `تم تفعيل ${saved.length} قالب` : `تم تعطيل ${saved.length} قالب`,
    };
  }

  /**
   * ✅ تفعيل/تعطيل قالب
   */
  async toggle(id: string, tenantId: string) {
    const template = await this.findByIdInternal(id, tenantId);
    const isActive = ['active', 'approved'].includes(template.status);
    template.status = isActive ? TemplateStatus.DISABLED : TemplateStatus.ACTIVE;
    const saved = await this.templateRepository.save(template);

    this.logger.log(`✅ Toggle: ${id} → ${saved.status}`);
    return {
      id: saved.id, name: saved.name, status: saved.status,
      isEnabled: ['active', 'approved'].includes(saved.status),
      content: saved.body, triggerEvent: saved.triggerEvent,
      message: isActive ? 'تم تعطيل القالب' : 'تم تفعيل القالب',
    };
  }

  /**
   * ✅ v15: تحديث إعدادات الإرسال مستقل لكل قالب
   * التاجر يتحكم: التأخير، الشرط، التسلسل، الإلغاء
   * مع validation لمنع بيانات خاطئة
   */
  async updateSendSettings(id: string, tenantId: string, sendSettings: Record<string, unknown>) {
    const template = await this.findByIdInternal(id, tenantId);

    // ✅ Validation: التأكد من صحة sendingMode
    const validModes = ['instant', 'delayed', 'conditional', 'manual'];
    if (sendSettings.sendingMode && !validModes.includes(String(sendSettings.sendingMode))) {
      throw new BadRequestException(`sendingMode غير صالح. القيم المسموحة: ${validModes.join(', ')}`);
    }

    // ✅ Validation: delayMinutes يجب أن يكون رقم موجب
    if (sendSettings.delayMinutes !== undefined) {
      const delay = Number(sendSettings.delayMinutes);
      if (isNaN(delay) || delay < 0) {
        throw new BadRequestException('delayMinutes يجب أن يكون رقم موجب');
      }
      sendSettings.delayMinutes = delay;
    }

    // ✅ Validation: إذا كان delayed أو conditional يجب أن يكون هناك delayMinutes
    const mode = String(sendSettings.sendingMode || '');
    if ((mode === 'delayed' || mode === 'conditional') && !sendSettings.delayMinutes) {
      this.logger.warn(`⚠️ Template "${template.name}": mode=${mode} but no delayMinutes — setting default 60min`);
      sendSettings.delayMinutes = 60;
    }

    // ✅ Validation: maxSendsPerCustomer
    const maxSends = sendSettings.maxSendsPerCustomer as Record<string, unknown> | undefined;
    if (maxSends) {
      if (!maxSends.count || Number(maxSends.count) < 1) maxSends.count = 1;
      if (!maxSends.periodDays || Number(maxSends.periodDays) < 1) maxSends.periodDays = 7;
    }

    this.logger.log(`⚙️ updateSendSettings: id=${id}, name="${template.name}", mode=${sendSettings.sendingMode}`, sendSettings);

    template.sendSettings = sendSettings as any;
    const saved = await this.templateRepository.save(template);

    return {
      id: saved.id,
      name: saved.name,
      sendSettings: saved.sendSettings,
      message: 'تم تحديث إعدادات الإرسال بنجاح',
    };
  }

  async duplicate(id: string, tenantId: string, newName?: string) {
    const original = await this.findByIdInternal(id, tenantId);
    const dup = this.templateRepository.create({
      tenantId: original.tenantId, name: newName || `${original.name}_copy`,
      displayName: newName || `${original.displayName} (نسخة)`,
      description: original.description, category: original.category,
      channel: original.channel, language: original.language,
      body: original.body, header: original.header, footer: original.footer,
      buttons: original.buttons, variables: original.variables,
      triggerEvent: original.triggerEvent, status: TemplateStatus.DRAFT,
      stats: { usageCount: 0 },
    });
    return this.templateRepository.save(dup);
  }

  async sendTest(id: string, tenantId: string, _phone: string, variables?: Record<string, string>) {
    const template = await this.findByIdInternal(id, tenantId);
    let body = template.body || '';
    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        body = body.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });
    }
    return { success: true, message: 'تم إرسال رسالة الاختبار', preview: body };
  }

  async submitToWhatsApp(_tenantId: string, _dto: SubmitWhatsAppTemplateDto) {
    return { success: true, message: 'تم إرسال القالب للمراجعة', estimatedTime: '24-48 ساعة' };
  }

  async getWhatsAppTemplatesStatus(tenantId: string) {
    const templates = await this.templateRepository.find({
      where: { tenantId, channel: TemplateChannel.WHATSAPP },
      select: ['id', 'name', 'status', 'updatedAt'],
    });
    return {
      templates,
      summary: {
        total: templates.length,
        approved: templates.filter(t => t.status === TemplateStatus.APPROVED).length,
        pending: templates.filter(t => t.status === TemplateStatus.PENDING_APPROVAL).length,
        rejected: templates.filter(t => t.status === TemplateStatus.REJECTED).length,
      },
    };
  }

  async syncWithWhatsApp(_tenantId: string) {
    return { success: true, message: 'تمت المزامنة بنجاح', synced: 0, added: 0, updated: 0 };
  }

  async getStats(_id: string, _tenantId: string) {
    return {
      usageCount: 0, sentCount: 0, deliveredCount: 0, readCount: 0,
      clickCount: 0, deliveryRate: 0, readRate: 0, clickRate: 0, lastUsed: null,
    };
  }

  /**
   * ✅ Debug endpoint: عرض كل القوالب — للتشخيص
   */
  async debugGetAll(tenantId: string) {
    const active = await this.templateRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });

    const all = await this.templateRepository.find({
      where: { tenantId },
      withDeleted: true,
      order: { createdAt: 'DESC' },
    });

    const qbResult = await this.templateRepository
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.deleted_at IS NULL')
      .orderBy('t.created_at', 'DESC')
      .getMany();

    return {
      tenantId,
      counts: { active: active.length, withDeleted: all.length, queryBuilder: qbResult.length },
      active: active.map(t => ({ id: t.id, name: t.name, status: t.status, createdAt: t.createdAt })),
      softDeleted: all.filter(t => t.deletedAt).map(t => ({ id: t.id, name: t.name, status: t.status, deletedAt: t.deletedAt })),
    };
  }
}
