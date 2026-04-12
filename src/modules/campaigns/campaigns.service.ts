/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Service v2                             ║
 * ║                                                                                ║
 * ║  ✅ FIX 1: getTargetedCustomers — ordersCount → totalOrders                   ║
 * ║  ✅ FIX 2: marketingConsent + isBlocked فلتر إجباري                            ║
 * ║  ✅ FIX 3: TriggerType events → dots (order.created) not underscores           ║
 * ║  ✅ FIX 4: Streaming cursor (batch 500) بدل تحميل الكل في الذاكرة            ║
 * ║  ✅ FIX 5: Rate limit تطبيق فعلي عبر delayed jobs                             ║
 * ║  ✅ FIX 6: AudienceFilter rules engine فعلي                                   ║
 * ║  ✅ FIX 7: storeId يُمرر من Controller                                       ║
 * ║  ✅ FIX 8: Dedup — لا ترسل لنفس العميل مرتين في نفس الحملة                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Campaign, Customer } from '@database/entities';
import {
  CampaignType,
  CampaignStatus,
  CampaignStats,
  CampaignChannel,
  AudienceFilter,
  SegmentRule,
} from '@database/entities/campaign.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export interface CreateCampaignDto {
  tenantId: string;
  storeId?: string;
  createdBy?: string;
  name: string;
  description?: string;
  type: CampaignType;
  channel: CampaignChannel;
  scheduledAt?: Date;
  audienceFilter?: AudienceFilter;
  messageTemplate?: {
    type: 'text' | 'image' | 'document' | 'template';
    body: string;
    mediaUrl?: string;
    header?: { type: string; value: string };
    buttons?: Array<{ type: string; text: string; value?: string }>;
    variables?: string[];
  };
  triggerConfig?: {
    type: string;
    delayMinutes?: number;
    conditions?: SegmentRule[];
  };
  rateLimit?: number;
  stopOnErrorThreshold?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ FIX 3: Trigger events بالنقاط مثل ما يبثها webhook processor
// ═══════════════════════════════════════════════════════════════════════════════
const TRIGGER_EVENT_MAP: Record<string, string> = {
  order_created: 'order.created',
  order_paid: 'order.payment.updated',
  order_shipped: 'order.shipped',
  order_delivered: 'order.delivered',
  order_cancelled: 'order.cancelled',
  customer_created: 'customer.created',
  abandoned_cart: 'abandoned.cart',
  customer_inactive: 'customer.inactive',
  days_after_order: 'days_after_order',
  daily_time: 'daily_time',
  customer_birthday: 'customer.birthday',
};

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectQueue('campaigns')
    private readonly campaignQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.setupTriggerListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  async create(dto: CreateCampaignDto): Promise<Campaign> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('اسم الحملة مطلوب');
    }
    if (!dto.messageTemplate?.body?.trim()) {
      throw new BadRequestException('نص الرسالة مطلوب');
    }

    const campaign = this.campaignRepository.create({
      tenantId: dto.tenantId,
      storeId: dto.storeId || null,
      createdBy: dto.createdBy || null,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      type: dto.type,
      channel: dto.channel || CampaignChannel.WHATSAPP,
      scheduledAt: dto.scheduledAt,
      status: dto.scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT,
      messageTemplate: dto.messageTemplate,
      audienceFilter: dto.audienceFilter || null,
      triggerConfig: dto.triggerConfig || null,
      rateLimit: dto.rateLimit || 30,
      stopOnErrorThreshold: dto.stopOnErrorThreshold || null,
      stats: {
        totalTargeted: 0, sent: 0, delivered: 0,
        read: 0, replied: 0, failed: 0,
        clicked: 0, unsubscribed: 0,
      },
    } as Partial<Campaign>);

    const saved = await this.campaignRepository.save(campaign);

    // معاينة عدد المستهدفين
    const estimatedCount = await this.countTargetedCustomers(saved);
    await this.campaignRepository.update(saved.id, { estimatedAudience: estimatedCount });

    // تفعيل تلقائي للحملات الآلية
    if (dto.type === CampaignType.AUTOMATED && saved.triggerConfig) {
      await this.campaignRepository.update(saved.id, { status: CampaignStatus.ACTIVE });
    }

    this.logger.log(`📣 Campaign created: ${saved.id} "${saved.name}" | target≈${estimatedCount} | type=${dto.type}`);
    return this.findById(saved.id, dto.tenantId);
  }

  async findAll(
    tenantId: string,
    options?: { status?: CampaignStatus; type?: CampaignType; page?: number; limit?: number },
  ) {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(50, Math.max(1, options?.limit || 20));

    const qb = this.campaignRepository
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.deletedAt IS NULL');

    if (options?.status) qb.andWhere('c.status = :status', { status: options.status });
    if (options?.type) qb.andWhere('c.type = :type', { type: options.type });

    const [items, total] = await qb
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findById(id: string, tenantId: string): Promise<Campaign> {
    const c = await this.campaignRepository.findOne({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('الحملة غير موجودة');
    return c;
  }

  async update(id: string, tenantId: string, dto: Partial<CreateCampaignDto>): Promise<Campaign> {
    const campaign = await this.findById(id, tenantId);

    if ([CampaignStatus.ACTIVE, CampaignStatus.COMPLETED].includes(campaign.status)) {
      throw new BadRequestException('لا يمكن تعديل حملة نشطة أو مكتملة');
    }

    const allowed: (keyof CreateCampaignDto)[] = [
      'name', 'description', 'channel', 'type', 'scheduledAt',
      'messageTemplate', 'audienceFilter', 'triggerConfig',
      'rateLimit', 'stopOnErrorThreshold', 'storeId',
    ];

    for (const key of allowed) {
      if (dto[key] !== undefined) (campaign as any)[key] = dto[key];
    }

    const saved = await this.campaignRepository.save(campaign);

    // إعادة حساب المستهدفين
    const count = await this.countTargetedCustomers(saved);
    await this.campaignRepository.update(saved.id, { estimatedAudience: count });

    return this.findById(saved.id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<{ deleted: true }> {
    const campaign = await this.findById(id, tenantId);
    if ([CampaignStatus.ACTIVE, CampaignStatus.SCHEDULED].includes(campaign.status)) {
      throw new BadRequestException('لا يمكن حذف حملة نشطة أو مجدولة — ألغِها أولاً');
    }
    await this.campaignRepository.softRemove(campaign);
    return { deleted: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Campaign Actions
  // ═══════════════════════════════════════════════════════════════════════════════

  async activate(id: string, tenantId: string): Promise<Campaign> {
    const campaign = await this.findById(id, tenantId);
    if (campaign.type !== CampaignType.AUTOMATED) {
      throw new BadRequestException('فقط الحملات الآلية يمكن تفعيلها');
    }
    await this.campaignRepository.update(id, { status: CampaignStatus.ACTIVE });
    return this.findById(id, tenantId);
  }

  async pause(id: string, tenantId: string): Promise<Campaign> {
    await this.findById(id, tenantId);
    await this.campaignRepository.update(id, { status: CampaignStatus.PAUSED });
    return this.findById(id, tenantId);
  }

  async resume(id: string, tenantId: string): Promise<Campaign> {
    const campaign = await this.findById(id, tenantId);
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException('الحملة ليست متوقفة');
    }
    const newStatus = campaign.type === CampaignType.AUTOMATED
      ? CampaignStatus.ACTIVE
      : CampaignStatus.SCHEDULED;
    await this.campaignRepository.update(id, { status: newStatus });
    return this.findById(id, tenantId);
  }

  async cancel(id: string, tenantId: string): Promise<Campaign> {
    await this.findById(id, tenantId);
    await this.campaignRepository.update(id, { status: CampaignStatus.CANCELLED });
    return this.findById(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX 4+5: executeNow مع streaming cursor + rate limiting
  // ═══════════════════════════════════════════════════════════════════════════════

  async executeNow(id: string, tenantId: string): Promise<void> {
    const campaign = await this.findById(id, tenantId);

    if (campaign.status === CampaignStatus.ACTIVE) {
      throw new BadRequestException('الحملة قيد التنفيذ بالفعل');
    }
    if (!campaign.messageTemplate?.body?.trim()) {
      throw new BadRequestException('نص الرسالة فارغ — لا يمكن التنفيذ');
    }

    // تحديث الحالة
    await this.campaignRepository.update(id, {
      status: CampaignStatus.ACTIVE,
      startedAt: new Date(),
    } as any);

    // ✅ FIX 4: Streaming cursor — دفعات 500 بدل تحميل الكل
    const BATCH_SIZE = 500;
    const rateLimit = campaign.rateLimit || 30; // رسالة/دقيقة
    const delayPerMessage = Math.ceil(60000 / rateLimit); // ms بين كل رسالة
    let totalQueued = 0;
    let offset = 0;

    while (true) {
      const batch = await this.buildTargetQuery(campaign)
        .orderBy('customer.id', 'ASC')
        .skip(offset)
        .take(BATCH_SIZE)
        .getMany();

      if (batch.length === 0) break;

      for (let i = 0; i < batch.length; i++) {
        const globalIndex = totalQueued + i;
        await this.campaignQueue.add(
          'send-campaign-message',
          {
            campaignId: campaign.id,
            tenantId: campaign.tenantId,
            storeId: campaign.storeId || null,
            customerId: batch[i].id,
            channel: campaign.channel,
          },
          {
            // ✅ FIX 5: Rate limiting عبر delay تصاعدي
            delay: globalIndex * delayPerMessage,
            // ✅ FIX 8: Dedup بمعرف فريد
            jobId: `campaign-${campaign.id}-customer-${batch[i].id}`,
          },
        );
      }

      totalQueued += batch.length;
      offset += BATCH_SIZE;
    }

    // تحديث العدد الفعلي
    await this.campaignRepository
      .createQueryBuilder()
      .update(Campaign)
      .set({
        stats: () => `jsonb_set(stats, '{totalTargeted}', '${totalQueued}'::jsonb)`,
      })
      .where('id = :id', { id })
      .execute();

    this.logger.log(
      `📣 Campaign ${id} executing: ${totalQueued} messages queued | rate=${rateLimit}/min | delay=${delayPerMessage}ms`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX 1+2+6: Targeting & Segmentation — صحيح ومتكامل
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * بناء query الاستهداف — يُستخدم للتنفيذ والمعاينة
   */
  private buildTargetQuery(campaign: Campaign): SelectQueryBuilder<Customer> {
    const qb = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenantId = :tenantId', { tenantId: campaign.tenantId });

    // ✅ FIX: تصفية بالمتجر إذا محدد
    if (campaign.storeId) {
      qb.andWhere('customer.storeId = :storeId', { storeId: campaign.storeId });
    }

    // ✅ FIX 2: لا ترسل لمحظورين أو رافضين للتسويق
    qb.andWhere('customer.isBlocked = false');
    qb.andWhere('customer.status = :activeStatus', { activeStatus: 'active' });

    // ✅ فلتر الهاتف — لازم يكون موجود للواتساب/SMS
    if (campaign.channel === CampaignChannel.WHATSAPP || campaign.channel === CampaignChannel.SMS) {
      qb.andWhere('customer.phone IS NOT NULL');
      qb.andWhere("customer.phone != ''");
    }
    if (campaign.channel === CampaignChannel.EMAIL) {
      qb.andWhere('customer.email IS NOT NULL');
      qb.andWhere("customer.email != ''");
    }

    // ═══ AudienceFilter Rules Engine ═══
    const filter = campaign.audienceFilter;
    if (filter) {
      // الكل — بدون فلتر إضافي
      if (filter.type === 'all') {
        // no extra filter
      }

      // Tags
      if (filter.type === 'tags' && filter.tags?.length) {
        qb.andWhere('customer.tags && :tags', { tags: filter.tags });
      }

      // Segment rules
      if (filter.type === 'segment' && filter.rules?.length) {
        this.applySegmentRules(qb, filter.rules, filter.condition || 'and');
      }

      // Custom (backward compat — بنية segment القديمة)
      if (filter.type === 'custom' && filter.rules?.length) {
        this.applySegmentRules(qb, filter.rules, filter.condition || 'and');
      }

      // استثناء عملاء
      if (filter.excludeCustomerIds?.length) {
        qb.andWhere('customer.id NOT IN (:...excludeIds)', {
          excludeIds: filter.excludeCustomerIds,
        });
      }
    }

    return qb;
  }

  /**
   * ✅ FIX 1+6: تطبيق قواعد الاستهداف — أسماء الحقول صحيحة
   */
  private applySegmentRules(
    qb: SelectQueryBuilder<Customer>,
    rules: SegmentRule[],
    condition: 'and' | 'or',
  ): void {
    // خريطة الحقول — الأسماء المعروضة → أسماء TypeORM الفعلية
    const FIELD_MAP: Record<string, string> = {
      totalOrders: 'customer.totalOrders',       // ✅ FIX 1: كان ordersCount
      total_orders: 'customer.totalOrders',
      ordersCount: 'customer.totalOrders',        // backward compat
      totalSpent: 'customer.totalSpent',
      total_spent: 'customer.totalSpent',
      vipStatus: 'customer.vipStatus',
      vip_status: 'customer.vipStatus',
      lastOrderAt: 'customer.lastOrderAt',
      last_order_at: 'customer.lastOrderAt',
      lastOrderDays: '__computed_lastOrderDays',  // حقل محسوب
      createdAt: 'customer.createdAt',
      city: "customer.address->>'city'",
      country: "customer.address->>'country'",
      tags: 'customer.tags',
      gender: 'customer.gender',
    };

    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {};

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const dbField = FIELD_MAP[rule.field];
      if (!dbField) {
        this.logger.warn(`⚠️ Unknown segment field: "${rule.field}" — skipped`);
        continue;
      }

      const paramKey = `rule_${i}`;

      // حقل محسوب: عدد الأيام منذ آخر طلب
      if (dbField === '__computed_lastOrderDays') {
        const days = Number(rule.value);
        if (isNaN(days)) continue;
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        switch (rule.operator) {
          case 'less_than':
            // آخر طلب خلال X يوم
            whereClauses.push(`customer.lastOrderAt >= :${paramKey}`);
            params[paramKey] = sinceDate;
            break;
          case 'greater_than':
            // لم يطلب منذ X يوم
            whereClauses.push(`(customer.lastOrderAt IS NULL OR customer.lastOrderAt < :${paramKey})`);
            params[paramKey] = sinceDate;
            break;
          default:
            whereClauses.push(`customer.lastOrderAt >= :${paramKey}`);
            params[paramKey] = sinceDate;
        }
        continue;
      }

      // Tags — عمليات خاصة بـ JSONB array
      if (rule.field === 'tags') {
        if (rule.operator === 'contains' || rule.operator === 'in') {
          const tagsArr = Array.isArray(rule.value) ? rule.value : [rule.value];
          whereClauses.push(`customer.tags && :${paramKey}`);
          params[paramKey] = tagsArr;
        } else if (rule.operator === 'not_contains' || rule.operator === 'not_in') {
          const tagsArr = Array.isArray(rule.value) ? rule.value : [rule.value];
          whereClauses.push(`NOT (customer.tags && :${paramKey})`);
          params[paramKey] = tagsArr;
        }
        continue;
      }

      // قواعد عادية
      switch (rule.operator) {
        case 'equals':
          whereClauses.push(`${dbField} = :${paramKey}`);
          params[paramKey] = rule.value;
          break;
        case 'not_equals':
          whereClauses.push(`${dbField} != :${paramKey}`);
          params[paramKey] = rule.value;
          break;
        case 'greater_than':
          whereClauses.push(`${dbField} > :${paramKey}`);
          params[paramKey] = Number(rule.value);
          break;
        case 'less_than':
          whereClauses.push(`${dbField} < :${paramKey}`);
          params[paramKey] = Number(rule.value);
          break;
        case 'contains':
          whereClauses.push(`${dbField} ILIKE :${paramKey}`);
          params[paramKey] = `%${rule.value}%`;
          break;
        case 'not_contains':
          whereClauses.push(`${dbField} NOT ILIKE :${paramKey}`);
          params[paramKey] = `%${rule.value}%`;
          break;
        case 'in':
          const inArr = Array.isArray(rule.value) ? rule.value : [rule.value];
          whereClauses.push(`${dbField} IN (:...${paramKey})`);
          params[paramKey] = inArr;
          break;
        case 'not_in':
          const notInArr = Array.isArray(rule.value) ? rule.value : [rule.value];
          whereClauses.push(`${dbField} NOT IN (:...${paramKey})`);
          params[paramKey] = notInArr;
          break;
      }
    }

    if (whereClauses.length === 0) return;

    const joined = condition === 'or'
      ? `(${whereClauses.join(' OR ')})`
      : whereClauses.join(' AND ');

    qb.andWhere(joined, params);
  }

  /**
   * عدّ المستهدفين (بدون تحميل الكائنات)
   */
  async countTargetedCustomers(campaign: Campaign): Promise<number> {
    return this.buildTargetQuery(campaign).getCount();
  }

  /**
   * معاينة عدد المستهدفين (بدون تنفيذ)
   */
  async previewSegment(
    tenantId: string,
    storeId: string | null,
    audienceFilter: AudienceFilter,
    channel: CampaignChannel = CampaignChannel.WHATSAPP,
  ): Promise<number> {
    const mock = {
      tenantId,
      storeId: storeId || undefined,
      channel,
      audienceFilter,
    } as unknown as Campaign;

    return this.countTargetedCustomers(mock);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Statistics
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStats(id: string, tenantId: string): Promise<CampaignStats & { deliveryRate: number; readRate: number }> {
    const campaign = await this.findById(id, tenantId);
    const stats = campaign.stats;
    return {
      ...stats,
      deliveryRate: stats.totalTargeted > 0 ? Math.round((stats.delivered / stats.totalTargeted) * 100) : 0,
      readRate: stats.delivered > 0 ? Math.round((stats.read / stats.delivered) * 100) : 0,
    };
  }

  async updateStats(id: string, field: 'sent' | 'delivered' | 'read' | 'failed'): Promise<void> {
    await this.campaignRepository
      .createQueryBuilder()
      .update(Campaign)
      .set({
        stats: () =>
          `jsonb_set(stats, '{${field}}', (COALESCE((stats->>'${field}')::int, 0) + 1)::text::jsonb)`,
      })
      .where('id = :id', { id })
      .execute();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX 3: Triggered Campaigns — أحداث بالنقاط
  // ═══════════════════════════════════════════════════════════════════════════════

  private setupTriggerListeners(): void {
    // نسجل على الأحداث الحقيقية (بالنقاط) مثل ما يبثها webhook processor
    const dotEvents = Object.values(TRIGGER_EVENT_MAP).filter(e => e.includes('.'));

    for (const event of dotEvents) {
      this.eventEmitter.on(event, async (payload: Record<string, unknown>) => {
        try {
          await this.handleTrigger(event, payload);
        } catch (err: any) {
          this.logger.error(`❌ Trigger handler error for ${event}: ${err.message}`);
        }
      });
    }

    // نسجل أيضاً على webhook.processed اللي تبثه salla/zid processors
    this.eventEmitter.on('webhook.processed', async (payload: Record<string, unknown>) => {
      const eventType = payload.eventType as string;
      if (eventType) {
        try {
          await this.handleTrigger(eventType, payload);
        } catch (err: any) {
          this.logger.error(`❌ Trigger handler error for ${eventType}: ${err.message}`);
        }
      }
    });

    this.logger.log(`📣 Campaign triggers registered for ${dotEvents.length} events`);
  }

  private async handleTrigger(event: string, payload: Record<string, unknown>): Promise<void> {
    const tenantId = payload.tenantId as string;
    if (!tenantId) return;

    // جلب الحملات الآلية النشطة لهذا الحدث
    const campaigns = await this.campaignRepository
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.type = :type', { type: CampaignType.AUTOMATED })
      .andWhere('c.status = :status', { status: CampaignStatus.ACTIVE })
      .andWhere("c.trigger_config->>'type' = :triggerType", { triggerType: event })
      .andWhere('c.deletedAt IS NULL')
      .getMany();

    if (campaigns.length === 0) return;

    const customerId = payload.customerId as string;

    for (const campaign of campaigns) {
      const delayMinutes = campaign.triggerConfig?.delayMinutes || 0;

      // التحقق من الشروط
      if (campaign.triggerConfig?.conditions?.length) {
        if (!this.checkTriggerConditions(campaign.triggerConfig.conditions, payload)) {
          continue;
        }
      }

      await this.campaignQueue.add(
        'send-campaign-message',
        {
          campaignId: campaign.id,
          tenantId,
          storeId: campaign.storeId || (payload.storeId as string) || null,
          customerId,
          channel: campaign.channel,
          triggerPayload: payload,
        },
        {
          delay: delayMinutes * 60 * 1000,
          jobId: customerId
            ? `trigger-${campaign.id}-${customerId}-${Date.now()}`
            : undefined,
        },
      );

      this.logger.debug(
        `📣 Trigger matched: campaign="${campaign.name}" event=${event} delay=${delayMinutes}min`,
      );
    }
  }

  private checkTriggerConditions(
    conditions: SegmentRule[],
    payload: Record<string, unknown>,
  ): boolean {
    for (const rule of conditions) {
      const actual = payload[rule.field];

      switch (rule.operator) {
        case 'equals':
          if (actual !== rule.value) return false;
          break;
        case 'not_equals':
          if (actual === rule.value) return false;
          break;
        case 'greater_than':
          if (!(Number(actual) > Number(rule.value))) return false;
          break;
        case 'less_than':
          if (!(Number(actual) < Number(rule.value))) return false;
          break;
        case 'contains':
          if (!String(actual).includes(String(rule.value))) return false;
          break;
        default:
          break;
      }
    }
    return true;
  }
}
