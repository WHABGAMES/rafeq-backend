/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tenants Service                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant, TenantStatus, SubscriptionPlan } from '@database/entities/tenant.entity';

export interface UpdateTenantDto {
  name?: string;
  logo?: string;
  phone?: string;
  website?: string;
  timezone?: string;
  defaultLanguage?: string;
  currency?: string;
  settings?: Record<string, unknown>;
  aiSettings?: Record<string, unknown>;
}

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`المستأجر غير موجود: ${id}`);
    }

    return tenant;
  }

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({
      where: { slug },
    });

    if (!tenant) {
      throw new NotFoundException(`المستأجر غير موجود: ${slug}`);
    }

    return tenant;
  }

  async findByEmail(email: string): Promise<Tenant | null> {
    return this.tenantRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  /**
   * ✅ إنشاء Tenant تلقائيًا عند تثبيت تطبيق سلة (Easy Mode)
   * - يضمن uniqueness للـ email والـ slug
   * - يعيد tenant موجود إذا كان البريد موجود
   */
  async createTenantFromSalla(input: {
    merchantId: number;
    name?: string;
    email?: string;
    phone?: string;
    logo?: string;
    website?: string;
  }): Promise<Tenant> {
    const email = (input.email || `merchant-${input.merchantId}@salla.local`).toLowerCase();

    // إذا موجود بنفس البريد نرجعه (تجنب تكرار unique constraint)
    const existingByEmail = await this.findByEmail(email);
    if (existingByEmail) return existingByEmail;

    // slug آمن ومميز
    const baseSlug = `salla-${input.merchantId}`;
    let slug = baseSlug;
    let i = 1;

    // في حال تضارب slug (نادر) نضيف suffix
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const found = await this.tenantRepository.findOne({ where: { slug } });
      if (!found) break;
      i += 1;
      slug = `${baseSlug}-${i}`;
    }

    const tenant = this.tenantRepository.create({
      name: input.name?.trim() || `Salla Merchant ${input.merchantId}`,
      email,
      slug,
      phone: input.phone,
      logo: input.logo,
      website: input.website,
      status: TenantStatus.ACTIVE,
      subscriptionPlan: SubscriptionPlan.FREE,
    });

    return this.tenantRepository.save(tenant);
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findById(id);
    Object.assign(tenant, dto);
    return this.tenantRepository.save(tenant);
  }

  async updateAiSettings(
    id: string,
    aiSettings: Record<string, unknown>,
  ): Promise<Tenant> {
    const tenant = await this.findById(id);

    tenant.aiSettings = {
      ...tenant.aiSettings,
      ...aiSettings,
    };

    return this.tenantRepository.save(tenant);
  }

  async updateSettings(
    id: string,
    settings: Record<string, unknown>,
  ): Promise<Tenant> {
    const tenant = await this.findById(id);

    tenant.settings = {
      ...tenant.settings,
      ...settings,
    };

    return this.tenantRepository.save(tenant);
  }

  async updateStatus(id: string, status: TenantStatus): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.status = status;
    return this.tenantRepository.save(tenant);
  }

  async upgradePlan(
    id: string,
    plan: SubscriptionPlan,
    endsAt: Date,
  ): Promise<Tenant> {
    const tenant = await this.findById(id);

    tenant.subscriptionPlan = plan;
    tenant.subscriptionEndsAt = endsAt;
    tenant.status = TenantStatus.ACTIVE;
    tenant.monthlyMessageLimit = this.getMessageLimitForPlan(plan);
    tenant.limits = this.getLimitsForPlan(plan);

    return this.tenantRepository.save(tenant);
  }

  async activateTrial(id: string, days: number = 14): Promise<Tenant> {
    const tenant = await this.findById(id);

    tenant.status = TenantStatus.TRIAL;
    tenant.trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    tenant.monthlyMessageLimit = 1000;

    return this.tenantRepository.save(tenant);
  }

  async incrementUsage(
    id: string,
    field: 'messagesCount' | 'conversationsCount' | 'aiCallsCount',
    amount: number = 1,
  ): Promise<void> {
    await this.tenantRepository
      .createQueryBuilder()
      .update(Tenant)
      .set({
        monthlyUsage: () =>
          `jsonb_set(monthly_usage, '{${field}}', (COALESCE((monthly_usage->>'${field}')::int, 0) + ${amount})::text::jsonb)`,
      })
      .where('id = :id', { id })
      .execute();
  }

  async resetMonthlyUsage(id: string): Promise<void> {
    await this.tenantRepository.update(id, {
      monthlyUsage: {
        messagesCount: 0,
        conversationsCount: 0,
        aiCallsCount: 0,
      },
    });
  }

  async checkMessageLimit(id: string): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
    remaining: number;
  }> {
    const tenant = await this.findById(id);
    const used = (tenant.monthlyUsage?.messagesCount as number) || 0;
    const limit = tenant.monthlyMessageLimit;
    const remaining = Math.max(0, limit - used);

    return {
      allowed: used < limit,
      used,
      limit,
      remaining,
    };
  }

  private getMessageLimitForPlan(plan: SubscriptionPlan): number {
    const limits: Record<SubscriptionPlan, number> = {
      [SubscriptionPlan.FREE]: 1000,
      [SubscriptionPlan.BASIC]: 5000,
      [SubscriptionPlan.PRO]: 25000,
      [SubscriptionPlan.ENTERPRISE]: 100000,
    };
    return limits[plan];
  }

  private getLimitsForPlan(plan: SubscriptionPlan): Record<string, number> {
    const limits: Record<SubscriptionPlan, Record<string, number>> = {
      [SubscriptionPlan.FREE]: {
        maxUsers: 2,
        maxStores: 1,
        maxChannels: 1,
        maxCampaigns: 5,
      },
      [SubscriptionPlan.BASIC]: {
        maxUsers: 5,
        maxStores: 2,
        maxChannels: 2,
        maxCampaigns: 20,
      },
      [SubscriptionPlan.PRO]: {
        maxUsers: 15,
        maxStores: 5,
        maxChannels: 5,
        maxCampaigns: 100,
      },
      [SubscriptionPlan.ENTERPRISE]: {
        maxUsers: -1,
        maxStores: -1,
        maxChannels: -1,
        maxCampaigns: -1,
      },
    };
    return limits[plan];
  }

  async isSubscriptionValid(id: string): Promise<boolean> {
    const tenant = await this.findById(id);

    if (tenant.status === TenantStatus.SUSPENDED) {
      return false;
    }

    if (tenant.status === TenantStatus.TRIAL) {
      return tenant.trialEndsAt ? tenant.trialEndsAt > new Date() : false;
    }

    if (tenant.status === TenantStatus.ACTIVE) {
      if (tenant.subscriptionPlan === SubscriptionPlan.FREE) {
        return true;
      }
      return tenant.subscriptionEndsAt
        ? tenant.subscriptionEndsAt > new Date()
        : false;
    }

    return false;
  }
}
