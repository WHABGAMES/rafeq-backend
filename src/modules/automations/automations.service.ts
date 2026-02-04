/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Automations Service                              ║
 * ║                                                                                ║
 * ║  ✅ v2: قاعدة بيانات حقيقية بدلاً من Map في الذاكرة                            ║
 * ║  ✅ محرك تنفيذ حقيقي يتكامل مع واتساب والقوالب                                ║
 * ║  ✅ مرتبط بالمتجر (storeId) لعزل البيانات                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Automation,
  AutomationStatus,
  AutomationAction,
} from './entities/automation.entity';
import { ChannelsService } from '../channels/channels.service';
import {
  CreateAutomationDto,
  UpdateAutomationDto,
} from './dto';

interface PaginationOptions {
  page: number;
  limit: number;
}

interface AutomationFilters {
  status?: string;
  trigger?: string;
  storeId?: string;
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,

    private readonly channelsService: ChannelsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD Operations - قاعدة بيانات حقيقية
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب جميع الأتمتات
   */
  async findAll(
    tenantId: string,
    filters: AutomationFilters,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.automationRepository
      .createQueryBuilder('automation')
      .where('automation.tenantId = :tenantId', { tenantId });

    if (filters.storeId) {
      qb.andWhere('automation.storeId = :storeId', { storeId: filters.storeId });
    }

    if (filters.status) {
      if (filters.status === 'active') {
        qb.andWhere('automation.enabled = :enabled', { enabled: true });
      } else if (filters.status === 'inactive') {
        qb.andWhere('automation.enabled = :enabled', { enabled: false });
      } else {
        qb.andWhere('automation.status = :status', { status: filters.status });
      }
    }

    if (filters.trigger) {
      qb.andWhere(`automation.trigger->>'type' = :trigger`, { trigger: filters.trigger });
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('automation.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * إنشاء أتمتة
   */
  async create(tenantId: string, dto: CreateAutomationDto) {
    // التحقق من عدم تكرار الاسم
    const existing = await this.automationRepository.findOne({
      where: { tenantId, name: dto.name },
    });
    if (existing) {
      throw new BadRequestException(`أتمتة بنفس الاسم "${dto.name}" موجودة بالفعل`);
    }

    const automation = this.automationRepository.create({
      tenantId,
      storeId: dto.storeId ?? undefined,
      name: dto.name,
      description: dto.description,
      trigger: dto.trigger || { type: 'manual' },
      actions: dto.actions || [],
      status: AutomationStatus.DRAFT,
      enabled: false,
      stats: { triggered: 0, successful: 0, failed: 0 },
    });

    const saved = await this.automationRepository.save(automation);

    this.logger.log(`✅ Automation created: ${saved.id}`, {
      tenantId,
      name: dto.name,
      trigger: dto.trigger?.type,
    });

    return saved;
  }

  /**
   * جلب أتمتة بالـ ID
   */
  async findById(id: string, tenantId: string) {
    const automation = await this.automationRepository.findOne({
      where: { id, tenantId },
    });

    if (!automation) {
      throw new NotFoundException('الأتمتة غير موجودة');
    }

    return automation;
  }

  /**
   * تحديث أتمتة
   */
  async update(id: string, tenantId: string, dto: UpdateAutomationDto) {
    const automation = await this.findById(id, tenantId);

    if (dto.name !== undefined) automation.name = dto.name;
    if (dto.description !== undefined) automation.description = dto.description;
    if (dto.trigger !== undefined) automation.trigger = dto.trigger;
    if (dto.actions !== undefined) automation.actions = dto.actions;
    if (dto.storeId !== undefined) automation.storeId = dto.storeId;

    const saved = await this.automationRepository.save(automation);

    this.logger.log(`✅ Automation updated: ${id}`, { tenantId });

    return saved;
  }

  /**
   * حذف أتمتة
   */
  async delete(id: string, tenantId: string) {
    const automation = await this.findById(id, tenantId);
    await this.automationRepository.remove(automation);
    this.logger.log(`🗑️ Automation deleted: ${id}`, { tenantId });
  }

  /**
   * تبديل حالة الأتمتة (تفعيل/تعطيل)
   */
  async toggle(id: string, tenantId: string) {
    const automation = await this.findById(id, tenantId);

    automation.enabled = !automation.enabled;
    automation.status = automation.enabled
      ? AutomationStatus.ACTIVE
      : AutomationStatus.INACTIVE;

    if (automation.enabled) {
      automation.activatedAt = new Date();
    }

    const saved = await this.automationRepository.save(automation);

    this.logger.log(
      `${saved.enabled ? '✅' : '⏸️'} Automation ${saved.enabled ? 'activated' : 'deactivated'}: ${id}`,
      { tenantId },
    );

    return saved;
  }

  /**
   * تفعيل أتمتة
   */
  async activate(id: string, tenantId: string) {
    const automation = await this.findById(id, tenantId);

    automation.enabled = true;
    automation.status = AutomationStatus.ACTIVE;
    automation.activatedAt = new Date();

    const saved = await this.automationRepository.save(automation);

    return {
      id: saved.id,
      status: 'active',
      enabled: true,
      message: 'تم تفعيل الأتمتة',
    };
  }

  /**
   * تعطيل أتمتة
   */
  async deactivate(id: string, tenantId: string) {
    const automation = await this.findById(id, tenantId);

    automation.enabled = false;
    automation.status = AutomationStatus.INACTIVE;

    const saved = await this.automationRepository.save(automation);

    return {
      id: saved.id,
      status: 'inactive',
      enabled: false,
      message: 'تم تعطيل الأتمتة',
    };
  }

  /**
   * إحصائيات الأتمتة
   */
  async getStats(id: string, tenantId: string) {
    const automation = await this.findById(id, tenantId);

    return {
      executionCount: automation.executionCount || 0,
      successCount: automation.stats?.successful || 0,
      failureCount: automation.stats?.failed || 0,
      lastExecutedAt: automation.lastExecutedAt,
      triggered: automation.stats?.triggered || 0,
    };
  }

  /**
   * سجلات الأتمتة (placeholder - يمكن ربطه بجدول logs مستقبلاً)
   */
  async getLogs(id: string, tenantId: string, pagination: PaginationOptions) {
    await this.findById(id, tenantId);

    return {
      data: [],
      pagination: {
        ...pagination,
        total: 0,
        totalPages: 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Execution Engine - محرك تنفيذ حقيقي
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * البحث عن الأتمتات المفعّلة حسب المحفز
   */
  async findByTrigger(tenantId: string, triggerType: string, storeId?: string): Promise<Automation[]> {
    const qb = this.automationRepository
      .createQueryBuilder('automation')
      .where('automation.tenantId = :tenantId', { tenantId })
      .andWhere('automation.enabled = :enabled', { enabled: true })
      .andWhere(`automation.trigger->>'type' = :triggerType`, { triggerType });

    if (storeId) {
      // أتمتات خاصة بالمتجر + أتمتات عامة (بدون storeId)
      qb.andWhere('(automation.storeId = :storeId OR automation.storeId IS NULL)', { storeId });
    }

    return qb.getMany();
  }

  /**
   * ✅ تنفيذ أتمتة - يُستدعى من Event Listeners
   */
  async executeAutomation(
    automationId: string,
    tenantId: string,
    context: Record<string, unknown>,
  ): Promise<{ success: boolean; automationId: string }> {
    const automation = await this.automationRepository.findOne({
      where: { id: automationId },
    });

    if (!automation || !automation.enabled) {
      this.logger.warn(`⚠️ Automation ${automationId} is not active - skipping`);
      return { success: false, automationId };
    }

    this.logger.log(`⚡ Executing automation: ${automation.name} (${automationId})`, {
      tenantId,
      trigger: automation.trigger.type,
      actionsCount: automation.actions.length,
    });

    const startTime = Date.now();
    let allSuccess = true;

    try {
      // تنفيذ كل إجراء بالترتيب
      for (const action of automation.actions || []) {
        try {
          await this.executeAction(action, context, automation);
        } catch (actionError) {
          const msg = actionError instanceof Error ? actionError.message : 'Unknown';
          this.logger.error(`❌ Action failed: ${action.type} - ${msg}`);
          allSuccess = false;
        }
      }

      // تحديث الإحصائيات
      automation.executionCount = (automation.executionCount || 0) + 1;
      automation.lastExecutedAt = new Date();
      automation.stats = {
        ...automation.stats,
        triggered: (automation.stats?.triggered || 0) + 1,
        successful: (automation.stats?.successful || 0) + (allSuccess ? 1 : 0),
        failed: (automation.stats?.failed || 0) + (allSuccess ? 0 : 1),
        lastTriggeredAt: new Date().toISOString(),
        ...(allSuccess
          ? { lastSuccessAt: new Date().toISOString() }
          : { lastFailAt: new Date().toISOString() }),
      };

      if (!allSuccess) {
        automation.lastError = 'One or more actions failed';
        automation.lastErrorAt = new Date();
      }

      await this.automationRepository.save(automation);

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Automation executed: ${automation.name} in ${duration}ms`, {
        success: allSuccess,
        automationId,
      });

      return { success: allSuccess, automationId };

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ Automation execution failed: ${msg}`, { automationId });

      // تحديث إحصائيات الفشل
      automation.stats = {
        ...automation.stats,
        triggered: (automation.stats?.triggered || 0) + 1,
        failed: (automation.stats?.failed || 0) + 1,
        lastTriggeredAt: new Date().toISOString(),
        lastFailAt: new Date().toISOString(),
      };
      automation.lastError = msg;
      automation.lastErrorAt = new Date();
      await this.automationRepository.save(automation);

      return { success: false, automationId };
    }
  }

  /**
   * ✅ تنفيذ إجراء واحد
   */
  private async executeAction(
    action: AutomationAction,
    context: Record<string, unknown>,
    automation: Automation,
  ): Promise<void> {
    this.logger.log(`🎯 Executing action: ${action.type}`, {
      automationId: automation.id,
      config: action.config,
    });

    switch (action.type) {
      case 'send_whatsapp':
      case 'send_message':
        await this.executeSendWhatsApp(action, context, automation);
        break;

      case 'send_template':
        await this.executeSendTemplate(action, context, automation);
        break;

      case 'delay':
        // التأخير يُعالج بنظام queue خارجي
        this.logger.log(`⏳ Delay action: ${action.delaySeconds || action.config?.delaySeconds || 0}s`);
        break;

      case 'add_tag':
        this.eventEmitter.emit('automation.action.add_tag', {
          tenantId: automation.tenantId,
          storeId: automation.storeId,
          tag: action.config?.tag,
          context,
        });
        break;

      case 'webhook':
        this.eventEmitter.emit('automation.action.webhook', {
          tenantId: automation.tenantId,
          url: action.config?.url,
          method: action.config?.method || 'POST',
          context,
        });
        break;

      default:
        this.logger.warn(`⚠️ Unknown action type: ${action.type}`);
    }
  }

  /**
   * ✅ إرسال رسالة واتساب مباشرة
   */
  private async executeSendWhatsApp(
    action: AutomationAction,
    context: Record<string, unknown>,
    automation: Automation,
  ): Promise<void> {
    const storeId = automation.storeId || (context.storeId as string);
    if (!storeId) {
      this.logger.warn('⚠️ No storeId for WhatsApp action');
      return;
    }

    const phone = (context.customerPhone as string) ||
                  (context.phone as string) ||
                  ((context.customer as any)?.mobile);

    if (!phone) {
      this.logger.warn('⚠️ No customer phone for WhatsApp action');
      return;
    }

    const message = action.message || (action.config?.message as string) || '';
    if (!message) {
      this.logger.warn('⚠️ No message content for WhatsApp action');
      return;
    }

    // البحث عن قناة واتساب متصلة للمتجر
    const channelsResult: any = await this.channelsService.findAll(storeId);
    const channelList: any[] = Array.isArray(channelsResult) ? channelsResult : channelsResult?.data || [];
    const waChannel = channelList.find(
      (c: any) =>
        c.status === 'connected' &&
        (c.type === 'whatsapp_qr' || c.type === 'whatsapp_official' ||
         c.type === 'WHATSAPP_QR' || c.type === 'WHATSAPP_OFFICIAL'),
    );

    if (!waChannel) {
      this.logger.warn(`⚠️ No active WhatsApp channel for store ${storeId}`);
      return;
    }

    try {
      await this.channelsService.sendWhatsAppMessage(waChannel.id, phone, message);
      this.logger.log(`📤 WhatsApp message sent via automation to ${phone}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ WhatsApp send failed: ${msg}`);
      throw error;
    }
  }

  /**
   * ✅ إرسال قالب
   */
  private async executeSendTemplate(
    action: AutomationAction,
    context: Record<string, unknown>,
    automation: Automation,
  ): Promise<void> {
    const templateId = action.templateId || (action.config?.templateId as string);
    if (!templateId) {
      this.logger.warn('⚠️ No templateId for send_template action');
      return;
    }

    // يُطلق حدث لمعالج القوالب
    this.eventEmitter.emit('automation.send_template', {
      templateId,
      tenantId: automation.tenantId,
      storeId: automation.storeId,
      context,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Event Listeners - يستمع لأحداث الويبهوكس ويبحث عن أتمتات مفعّلة
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnEvent('order.created')
  async onOrderCreated(payload: Record<string, unknown>) {
    await this.triggerAutomations('order_created', payload);
  }

  @OnEvent('customer.created')
  async onCustomerCreated(payload: Record<string, unknown>) {
    await this.triggerAutomations('customer_created', payload);
  }

  @OnEvent('cart.abandoned')
  async onCartAbandoned(payload: Record<string, unknown>) {
    await this.triggerAutomations('cart_abandoned', payload);
  }

  @OnEvent('order.shipped')
  async onOrderShipped(payload: Record<string, unknown>) {
    await this.triggerAutomations('order_shipped', payload);
  }

  @OnEvent('order.delivered')
  async onOrderDelivered(payload: Record<string, unknown>) {
    await this.triggerAutomations('order_delivered', payload);
  }

  @OnEvent('order.cancelled')
  async onOrderCancelled(payload: Record<string, unknown>) {
    await this.triggerAutomations('order_cancelled', payload);
  }

  /**
   * ✅ البحث عن أتمتات مطابقة وتنفيذها
   */
  private async triggerAutomations(
    triggerType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const tenantId = payload.tenantId as string;
    const storeId = payload.storeId as string;

    if (!tenantId) return;

    try {
      const automations = await this.findByTrigger(tenantId, triggerType, storeId);

      if (automations.length === 0) return;

      this.logger.log(`⚡ Found ${automations.length} automations for trigger: ${triggerType}`);

      for (const automation of automations) {
        // تنفيذ بدون blocking
        this.executeAutomation(automation.id, tenantId, payload).catch((err) => {
          this.logger.error(`❌ Automation ${automation.id} failed: ${err.message}`);
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`❌ triggerAutomations failed: ${msg}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Workflows (placeholder for future expansion)
  // ═══════════════════════════════════════════════════════════════════════════════

  async getWorkflows(_tenantId: string, pagination: PaginationOptions) {
    // Workflows will be built on top of automations
    return {
      data: [],
      pagination: { ...pagination, total: 0, totalPages: 0 },
    };
  }

  async createWorkflow(tenantId: string, dto: any) {
    return this.create(tenantId, dto);
  }

  async getWorkflowById(id: string, tenantId: string) {
    return this.findById(id, tenantId);
  }

  async updateWorkflow(id: string, tenantId: string, dto: any) {
    return this.update(id, tenantId, dto);
  }

  async deleteWorkflow(id: string, tenantId: string) {
    return this.delete(id, tenantId);
  }
}
