/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Service                                ║
 * ║                                                                                ║
 * ║  📌 Business Logic لإدارة الحملات التسويقية                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Campaign, Customer } from '@database/entities';
import { CampaignType, CampaignStatus, CampaignStats, TriggerType, CampaignChannel } from '@database/entities/campaign.entity';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📌 DTOs & Interfaces
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface CreateCampaignDto {
  tenantId: string;
  name: string;
  type: CampaignType;
  channel: CampaignChannel;
  
  // للحملات المجدولة
  scheduledAt?: Date;
  
  // للحملات المشروطة
  trigger?: TriggerType;
  triggerConditions?: Record<string, unknown>;
  delay?: number; // بالدقائق
  
  // الاستهداف
  segment?: {
    tags?: string[];
    minOrders?: number;
    maxOrders?: number;
    minTotal?: number;
    lastOrderDays?: number;
  };
  
  // القالب
  templateId?: string;
  customTemplate?: {
    content: string;
    mediaUrl?: string;
  };
}

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectQueue('campaigns')
    private readonly campaignQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // الاستماع للأحداث لتفعيل الحملات المشروطة
    this.setupTriggerListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📖 CRUD Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إنشاء حملة جديدة
   */
  async create(dto: CreateCampaignDto): Promise<Campaign> {
    // إنشاء الحملة
    const campaign = this.campaignRepository.create({
      tenantId: dto.tenantId,
      name: dto.name,
      type: dto.type,
      channel: dto.channel,
      scheduledAt: dto.scheduledAt,
      status: dto.scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT,
      stats: {
        totalTargeted: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        failed: 0,
        clicked: 0,
        unsubscribed: 0,
      },
    } as Partial<Campaign>);

    const saved = await this.campaignRepository.save(campaign);

    // إذا كانت حملة مشروطة، نفعّلها
    if (dto.type === CampaignType.AUTOMATED) {
      await this.activate((saved as Campaign).id);
    }

    return saved as Campaign;
  }

  /**
   * جلب حملات المستأجر
   */
  async findAll(
    tenantId: string,
    options?: {
      status?: CampaignStatus;
      type?: CampaignType;
      page?: number;
      limit?: number;
    },
  ) {
    const page = options?.page || 1;
    const limit = options?.limit || 20;

    const queryBuilder = this.campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.tenantId = :tenantId', { tenantId });

    if (options?.status) {
      queryBuilder.andWhere('campaign.status = :status', {
        status: options.status,
      });
    }

    if (options?.type) {
      queryBuilder.andWhere('campaign.type = :type', { type: options.type });
    }

    const [items, total] = await queryBuilder
      .orderBy('campaign.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * جلب حملة بالـ ID
   */
  async findById(id: string, tenantId: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id, tenantId },
    });

    if (!campaign) {
      throw new NotFoundException('الحملة غير موجودة');
    }

    return campaign;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ⚡ Campaign Actions
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تفعيل حملة مشروطة
   */
  async activate(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    
    if (!campaign) {
      throw new NotFoundException('الحملة غير موجودة');
    }

    if (campaign.type !== CampaignType.AUTOMATED) {
      throw new BadRequestException('فقط الحملات المشروطة يمكن تفعيلها');
    }

    (campaign as unknown as Record<string, unknown>).status = CampaignStatus.ACTIVE;
    return this.campaignRepository.save(campaign);
  }

  /**
   * إيقاف حملة مؤقتاً
   */
  async pause(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    
    if (!campaign) {
      throw new NotFoundException('الحملة غير موجودة');
    }

    (campaign as unknown as Record<string, unknown>).status = CampaignStatus.PAUSED;
    return this.campaignRepository.save(campaign);
  }

  /**
   * استئناف حملة متوقفة
   */
  async resume(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    
    if (!campaign) {
      throw new NotFoundException('الحملة غير موجودة');
    }

    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new BadRequestException('الحملة ليست متوقفة');
    }

    (campaign as unknown as Record<string, unknown>).status =
      campaign.type === CampaignType.AUTOMATED
        ? CampaignStatus.ACTIVE
        : CampaignStatus.SCHEDULED;

    return this.campaignRepository.save(campaign);
  }

  /**
   * إلغاء حملة
   */
  async cancel(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    
    if (!campaign) {
      throw new NotFoundException('الحملة غير موجودة');
    }

    (campaign as unknown as Record<string, unknown>).status = CampaignStatus.CANCELLED;
    return this.campaignRepository.save(campaign);
  }

  /**
   * تنفيذ حملة مجدولة فوراً
   */
  async executeNow(id: string, tenantId: string): Promise<void> {
    const campaign = await this.findById(id, tenantId);

    if (campaign.status === CampaignStatus.ACTIVE) {
      throw new BadRequestException('الحملة قيد التنفيذ بالفعل');
    }

    // تغيير الحالة
    (campaign as unknown as Record<string, unknown>).status = CampaignStatus.ACTIVE;
    await this.campaignRepository.save(campaign);

    // جلب العملاء المستهدفين
    const customers = await this.getTargetedCustomers(campaign);

    // تحديث العدد
    (campaign as unknown as Record<string, unknown>).stats = {
      ...(campaign as unknown as Record<string, unknown>).stats as Record<string, unknown>,
      totalTargeted: customers.length,
    };
    await this.campaignRepository.save(campaign);

    // إضافة jobs للـ queue
    for (const customer of customers) {
      await this.campaignQueue.add(
        'send-campaign-message',
        {
          campaignId: campaign.id,
          customerId: customer.id,
          channel: (campaign as unknown as Record<string, unknown>).channel,
        },
        {
          delay: 0, // بدون تأخير
        },
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎯 Targeting & Segmentation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب العملاء المستهدفين بناءً على الـ segment
   */
  async getTargetedCustomers(campaign: Campaign): Promise<Customer[]> {
    const queryBuilder = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenantId = :tenantId', { tenantId: (campaign as unknown as Record<string, unknown>).tenantId });

    const segment = (campaign as unknown as Record<string, unknown>).segment as Record<string, unknown>;

    if (segment) {
      // فلترة بالـ tags
      if (segment.tags && Array.isArray(segment.tags)) {
        queryBuilder.andWhere('customer.tags && :tags', {
          tags: segment.tags,
        });
      }

      // فلترة بعدد الطلبات
      if (segment.minOrders) {
        queryBuilder.andWhere('customer.ordersCount >= :minOrders', {
          minOrders: segment.minOrders,
        });
      }
      if (segment.maxOrders) {
        queryBuilder.andWhere('customer.ordersCount <= :maxOrders', {
          maxOrders: segment.maxOrders,
        });
      }

      // فلترة بإجمالي المشتريات
      if (segment.minTotal) {
        queryBuilder.andWhere('customer.totalSpent >= :minTotal', {
          minTotal: segment.minTotal,
        });
      }

      // فلترة بتاريخ آخر طلب
      if (segment.lastOrderDays) {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - (segment.lastOrderDays as number));
        queryBuilder.andWhere('customer.lastOrderAt >= :sinceDate', {
          sinceDate,
        });
      }
    }

    return queryBuilder.getMany();
  }

  /**
   * معاينة عدد العملاء المستهدفين (بدون تنفيذ)
   */
  async previewSegment(
    tenantId: string,
    segment: Record<string, unknown>,
  ): Promise<number> {
    const mockCampaign = {
      tenantId,
      segment,
    } as unknown as Campaign;

    const customers = await this.getTargetedCustomers(mockCampaign);
    return customers.length;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Statistics
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب إحصائيات حملة
   */
  async getStats(id: string, tenantId: string): Promise<CampaignStats & { deliveryRate: number; readRate: number }> {
    const campaign = await this.findById(id, tenantId);
    const stats = (campaign as unknown as Record<string, unknown>).stats as CampaignStats;

    return {
      ...stats,
      deliveryRate:
        stats.totalTargeted > 0
          ? (stats.delivered / stats.totalTargeted) * 100
          : 0,
      readRate:
        stats.delivered > 0 ? (stats.read / stats.delivered) * 100 : 0,
    };
  }

  /**
   * تحديث إحصائيات الحملة
   */
  async updateStats(
    id: string,
    field: 'sent' | 'delivered' | 'read' | 'failed',
  ): Promise<void> {
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
  // 🔔 Triggered Campaigns
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إعداد المستمعين للأحداث
   */
  private setupTriggerListeners(): void {
    // الاستماع لجميع أحداث الحملات المشروطة
    Object.values(TriggerType).forEach((event) => {
      this.eventEmitter.on(event, async (payload) => {
        await this.handleTriggerType(event, payload);
      });
    });
  }

  /**
   * معالجة حدث trigger
   */
  private async handleTriggerType(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const tenantId = payload.tenantId as string;
    const customerId = payload.customerId as string;

    // جلب الحملات النشطة لهذا الحدث
    const campaigns = await this.campaignRepository.find({
      where: {
        tenantId,
        type: CampaignType.AUTOMATED as string,
        trigger: event,
        status: CampaignStatus.ACTIVE as string,
      } as Record<string, unknown>,
    });

    for (const campaign of campaigns) {
      // التحقق من الشروط
      if (this.checkTriggerConditions(campaign, payload)) {
        // إضافة للـ queue مع التأخير
        await this.campaignQueue.add(
          'send-campaign-message',
          {
            campaignId: campaign.id,
            customerId,
            payload,
          },
          {
            delay: ((campaign as unknown as Record<string, unknown>).delay as number || 0) * 60 * 1000, // تحويل من دقائق لـ ms
          },
        );
      }
    }
  }

  /**
   * التحقق من شروط الـ trigger
   */
  private checkTriggerConditions(
    campaign: Campaign,
    payload: Record<string, unknown>,
  ): boolean {
    const conditions = (campaign as unknown as Record<string, unknown>).triggerConditions as Record<string, unknown>;
    
    if (!conditions) return true;

    // التحقق من كل شرط
    for (const [key, expectedValue] of Object.entries(conditions)) {
      const actualValue = payload[key];
      
      if (typeof expectedValue === 'object' && expectedValue !== null) {
        // شروط متقدمة (gt, lt, etc.)
        const condition = expectedValue as Record<string, unknown>;
        if (condition.gt !== undefined && !(actualValue as number > (condition.gt as number))) {
          return false;
        }
        if (condition.lt !== undefined && !(actualValue as number < (condition.lt as number))) {
          return false;
        }
      } else if (actualValue !== expectedValue) {
        return false;
      }
    }

    return true;
  }
}
