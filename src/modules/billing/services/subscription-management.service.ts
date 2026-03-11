/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Subscription Management Service                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ✅ Subscription entity + enums
import {
  Subscription,
  SubscriptionStatus,
  BillingInterval,
  UsageStats,
} from '@database/entities/subscription.entity';

// ✅ SubscriptionPlan ENTITY (جدول الخطط)
import { SubscriptionPlan as SubscriptionPlanEntity } from '@database/entities/subscription-plan.entity';

// ✅ Tenant entity + SubscriptionPlan ENUM (حقل الباقة في Tenant)
import {
  Tenant,
  TenantStatus,
  SubscriptionPlan as TenantPlanEnum,
} from '@database/entities/tenant.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export enum PlanTier {
  NONE = 'none',
  BASIC = 'basic',
  PROFESSIONAL = 'professional',
}

export const PLAN_MESSAGE_LIMITS: Record<PlanTier, number> = {
  [PlanTier.NONE]: 0,
  [PlanTier.BASIC]: 1000,
  [PlanTier.PROFESSIONAL]: 10000,
};

export interface PlanFeatureSet {
  templates: boolean;
  customerNotifications: boolean;
  aiBot: boolean;
  campaigns: boolean;
  advancedAnalytics: boolean;
  apiAccess: boolean;
  maxStores: number;
  maxUsers: number;
  maxChannels: number;
}

export const PLAN_FEATURES: Record<PlanTier, PlanFeatureSet> = {
  [PlanTier.NONE]: {
    templates: false, customerNotifications: false, aiBot: false,
    campaigns: false, advancedAnalytics: false, apiAccess: false,
    maxStores: 1, maxUsers: 1, maxChannels: 1,
  },
  [PlanTier.BASIC]: {
    templates: true, customerNotifications: true, aiBot: false,
    campaigns: true, advancedAnalytics: false, apiAccess: false,
    maxStores: 3, maxUsers: 3, maxChannels: 2,
  },
  [PlanTier.PROFESSIONAL]: {
    templates: true, customerNotifications: true, aiBot: true,
    campaigns: true, advancedAnalytics: true, apiAccess: true,
    maxStores: 10, maxUsers: 10, maxChannels: 5,
  },
};

export interface SubscriptionInfo {
  tenantId: string;
  plan: PlanTier;
  status: string;
  messagesUsed: number;
  messagesLimit: number;
  messagesRemaining: number;
  features: PlanFeatureSet;
  currentPeriodEnd?: Date;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class SubscriptionManagementService {
  private readonly logger = new Logger(SubscriptionManagementService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    @InjectRepository(SubscriptionPlanEntity)
    private readonly planRepo: Repository<SubscriptionPlanEntity>,

    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── 1. الحصول على معلومات الاشتراك ──────────────────────────────────────

  async getSubscriptionInfo(tenantId: string): Promise<SubscriptionInfo> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });

    if (!subscription || !this.isSubscriptionActive(subscription)) {
      return this.buildNoSubscriptionInfo(tenantId);
    }

    const planTier = this.resolvePlanTier(subscription);
    const messagesLimit = PLAN_MESSAGE_LIMITS[planTier];
    const messagesUsed = subscription.usageStats?.messagesUsed || 0;

    return {
      tenantId,
      plan: planTier,
      status: subscription.status,
      messagesUsed,
      messagesLimit,
      messagesRemaining: Math.max(0, messagesLimit - messagesUsed),
      features: PLAN_FEATURES[planTier],
      currentPeriodEnd: subscription.currentPeriodEnd,
      isActive: true,
    };
  }

  // ─── 2. التحقق من حدود الرسائل ─────────────────────────────────────────

  async checkMessageQuota(tenantId: string, count: number = 1): Promise<void> {
    const info = await this.getSubscriptionInfo(tenantId);

    if (!info.isActive) {
      throw new ForbiddenException({
        code: 'NO_SUBSCRIPTION',
        message: 'لا يوجد اشتراك نشط. يرجى الاشتراك في إحدى الباقات.',
      });
    }

    if (info.messagesRemaining < count) {
      throw new ForbiddenException({
        code: 'MESSAGE_QUOTA_EXCEEDED',
        message: `تم تجاوز الحد الشهري (${info.messagesLimit} رسالة).`,
        plan: info.plan,
        messagesUsed: info.messagesUsed,
        messagesLimit: info.messagesLimit,
        upgradeRequired: info.plan === PlanTier.BASIC,
      });
    }
  }

  /** زيادة عداد الرسائل atomically */
  async incrementMessageUsage(tenantId: string, count: number = 1): Promise<void> {
    await this.subscriptionRepo
      .createQueryBuilder()
      .update(Subscription)
      .set({
        usageStats: () =>
          `jsonb_set(COALESCE(usage_stats,'{}'),'{messagesUsed}',(COALESCE((usage_stats->>'messagesUsed')::int,0)+${count})::text::jsonb)`,
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status IN (:...s)', { s: ['active', 'trialing'] })
      .execute();
  }

  // ─── 3. التحقق من ميزات AI ─────────────────────────────────────────────

  async checkAIAccess(tenantId: string): Promise<{
    allowed: boolean;
    plan: PlanTier;
    upgradeRequired: boolean;
  }> {
    const info = await this.getSubscriptionInfo(tenantId);
    if (!info.isActive || !info.features.aiBot) {
      return { allowed: false, plan: info.plan, upgradeRequired: true };
    }
    return { allowed: true, plan: info.plan, upgradeRequired: false };
  }

  async enforceAIAccess(tenantId: string): Promise<void> {
    const access = await this.checkAIAccess(tenantId);
    if (!access.allowed) {
      throw new ForbiddenException({
        code: 'AI_ACCESS_DENIED',
        message: 'ميزات الذكاء الاصطناعي متاحة فقط في الباقة الاحترافية.',
        plan: access.plan,
        upgradeRequired: true,
      });
    }
  }

  // ─── 4. تعيين الباقة يدوياً (Admin) ────────────────────────────────────

  async adminSetPlan(
    tenantId: string,
    plan: PlanTier,
    adminId: string,
    reason?: string,
  ): Promise<SubscriptionInfo> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException(`التاجر غير موجود: ${tenantId}`);
    }

    // إلغاء الاشتراك
    if (plan === PlanTier.NONE) {
      await this.subscriptionRepo
        .createQueryBuilder()
        .update(Subscription)
        .set({
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
          endsAt: new Date(),
        })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('status IN (:...s)', { s: ['active', 'trialing', 'past_due'] })
        .execute();

      await this.tenantRepo.update(tenantId, {
        subscriptionPlan: TenantPlanEnum.FREE,
        monthlyMessageLimit: 0,
      });

      this.logger.log(`Admin ${adminId} removed subscription: ${tenantId}`);
      this.eventEmitter.emit('subscription.admin_changed', { tenantId, plan, adminId });
      return this.getSubscriptionInfo(tenantId);
    }

    // إنشاء أو تحديث الاشتراك
    const planEntity = await this.findOrCreatePlan(plan);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const newUsageStats: UsageStats = {
      messagesUsed: 0,
      messagesLimit: PLAN_MESSAGE_LIMITS[plan],
      storesCount: 0,
      storesLimit: PLAN_FEATURES[plan].maxStores,
      usersCount: 0,
      usersLimit: PLAN_FEATURES[plan].maxUsers,
      storageUsed: 0,
      storageLimit: 1000,
      lastUpdated: now.toISOString(),
    };

    let sub = await this.subscriptionRepo.findOne({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });

    if (sub) {
      sub.planId = planEntity.id;
      sub.status = SubscriptionStatus.ACTIVE;
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = periodEnd;
      sub.amount = planEntity.pricing?.monthlyPrice || 0;
      sub.usageStats = newUsageStats;
      // ✅ FIX: مسح تواريخ الإلغاء عند إعادة التفعيل
      sub.cancelledAt = null as any;
      sub.endsAt = null as any;
      (sub as any).metadata = {
        ...(sub.metadata || {}),
        notes: `Admin ${adminId}: ${reason || `Set plan to ${plan}`} at ${now.toISOString()}`,
        cancellationReason: undefined,
      };
    } else {
      sub = this.subscriptionRepo.create({
        tenantId,
        planId: planEntity.id,
        status: SubscriptionStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        currency: 'SAR',
        amount: planEntity.pricing?.monthlyPrice || 0,
        autoRenew: true,
        usageStats: newUsageStats,
        paymentMethods: [],
        metadata: { createdBy: 'admin', adminId, reason },
      } as unknown as Subscription);
    }

    await this.subscriptionRepo.save(sub);

    // تحديث Tenant بالـ enum الصحيح
    const tenantPlan = plan === PlanTier.PROFESSIONAL
      ? TenantPlanEnum.PRO
      : TenantPlanEnum.BASIC;

    await this.tenantRepo.update(tenantId, {
      subscriptionPlan: tenantPlan,
      status: TenantStatus.ACTIVE,
      monthlyMessageLimit: PLAN_MESSAGE_LIMITS[plan],
    });

    this.logger.log(`✅ Admin ${adminId} set tenant ${tenantId} → ${plan}`);
    this.eventEmitter.emit('subscription.admin_changed', { tenantId, plan, adminId });

    return this.getSubscriptionInfo(tenantId);
  }

  // ─── 5. معالجة أحداث Webhooks ────────────────────────────────────────

  async handleWebhookSubscription(params: {
    tenantId: string;
    storeId: string;
    platform: 'salla' | 'zid';
    event: 'subscribe' | 'unsubscribe' | 'upgrade' | 'downgrade' | 'renew';
    planSlug: string;
    externalSubscriptionId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<void> {
    const { tenantId, platform, event, planSlug } = params;
    const plan = this.mapExternalPlanToTier(planSlug);

    this.logger.log(`📥 Webhook: ${platform}.${event} plan=${planSlug}→${plan} tenant=${tenantId}`);

    if (event === 'unsubscribe') {
      await this.deactivateSubscription(tenantId, platform);
    } else {
      await this.activateSubscription(tenantId, plan, {
        source: platform,
        externalId: params.externalSubscriptionId,
        endDate: params.endDate,
      });
    }

    this.eventEmitter.emit('subscription.webhook_processed', { tenantId, platform, event, plan });
  }

  // ─── 6. قائمة الاشتراكات (Admin) ──────────────────────────────────────

  async listAllSubscriptions(filters: {
    page?: number;
    limit?: number;
    plan?: PlanTier;
    search?: string;
  }): Promise<{
    items: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page = 1, limit = 50 } = { page: filters.page || 1, limit: filters.limit || 50 };

    const whereConditions: string[] = ['1=1'];
    const params: any[] = [];
    let idx = 1;

    if (filters.search) {
      whereConditions.push(`(t.name ILIKE $${idx} OR t.email ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const whereClause = whereConditions.join(' AND ');

    // ✅ نفس نمط admin-users.service.ts — LIMIT/OFFSET كـ parameters
    const dataQuery = `
      SELECT
        t.id, t.name, t.email, t.subscription_plan,
        s.status AS sub_status,
        s.usage_stats,
        s.current_period_end
      FROM tenants t
      LEFT JOIN subscriptions s
        ON s.tenant_id = t.id
        AND s.status IN ('active','trialing','past_due','cancelling')
      WHERE ${whereClause}
        AND t.deleted_at IS NULL
      ORDER BY t.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const dataParams = [...params, limit, (page - 1) * limit];

    const countQuery = `
      SELECT COUNT(*) AS count
      FROM tenants t
      WHERE ${whereClause} AND t.deleted_at IS NULL
    `;

    const [rows, countResult] = await Promise.all([
      this.dataSource.query(dataQuery, dataParams),
      this.dataSource.query(countQuery, params),
    ]);

    const total = parseInt(countResult[0]?.count || '0', 10);

    const items = rows.map((row: any) => {
      const usageStats = row.usage_stats || {};
      const resolvedPlan = this.mapTenantPlanToTier(row.subscription_plan || 'free');

      return {
        tenantId: row.id,
        tenantName: row.name || '',
        email: row.email || '',
        plan: resolvedPlan,
        status: row.sub_status || (resolvedPlan !== PlanTier.NONE ? 'active' : 'none'),
        messagesUsed: usageStats.messagesUsed || 0,
        messagesLimit: PLAN_MESSAGE_LIMITS[resolvedPlan],
        currentPeriodEnd: row.current_period_end || null,
      };
    });

    const filtered = filters.plan
      ? items.filter((i: any) => i.plan === filters.plan)
      : items;

    return { items: filtered, total, page, limit };
  }

  // ─── 7. إعادة تعيين الاستخدام الشهري ──────────────────────────────────

  async resetAllMonthlyUsage(): Promise<number> {
    const result = await this.subscriptionRepo
      .createQueryBuilder()
      .update(Subscription)
      .set({
        usageStats: () =>
          `jsonb_set(jsonb_set(usage_stats,'{messagesUsed}','0'),'{lastUpdated}',to_jsonb(now()::text))`,
      })
      .where('status IN (:...s)', { s: ['active', 'trialing'] })
      .execute();

    const count = result.affected || 0;
    this.logger.log(`🔄 Monthly usage reset: ${count} subscriptions`);
    return count;
  }

  async resetTenantUsage(tenantId: string): Promise<boolean> {
    const result = await this.subscriptionRepo
      .createQueryBuilder()
      .update(Subscription)
      .set({
        usageStats: () =>
          `jsonb_set(jsonb_set(usage_stats,'{messagesUsed}','0'),'{lastUpdated}',to_jsonb(now()::text))`,
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status IN (:...s)', { s: ['active', 'trialing'] })
      .execute();

    return (result.affected || 0) > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  private buildNoSubscriptionInfo(tenantId: string): SubscriptionInfo {
    return {
      tenantId, plan: PlanTier.NONE, status: 'none',
      messagesUsed: 0, messagesLimit: 0, messagesRemaining: 0,
      features: PLAN_FEATURES[PlanTier.NONE], isActive: false,
    };
  }

  private resolvePlanTier(subscription: Subscription): PlanTier {
    const slug = (subscription.plan?.slug || subscription.plan?.name || '').toLowerCase();
    if (slug.includes('professional') || slug.includes('pro') || slug.includes('enterprise'))
      return PlanTier.PROFESSIONAL;
    if (slug.includes('basic') || slug.includes('starter') || slug.includes('growth'))
      return PlanTier.BASIC;
    return PlanTier.BASIC;
  }

  private isSubscriptionActive(sub: Subscription): boolean {
    return ['active', 'trialing', 'past_due', 'cancelling'].includes(sub.status);
  }

  private mapExternalPlanToTier(slug: string): PlanTier {
    const s = (slug || '').toLowerCase();
    if (s.includes('pro') || s.includes('premium') || s.includes('enterprise') || s.includes('احترافي'))
      return PlanTier.PROFESSIONAL;
    return PlanTier.BASIC;
  }

  private mapTenantPlanToTier(tenantPlan: string): PlanTier {
    if (tenantPlan === 'pro' || tenantPlan === 'enterprise') return PlanTier.PROFESSIONAL;
    if (tenantPlan === 'basic') return PlanTier.BASIC;
    return PlanTier.NONE;
  }

  private async findOrCreatePlan(tier: PlanTier): Promise<SubscriptionPlanEntity> {
    const slug = tier === PlanTier.PROFESSIONAL ? 'professional' : 'basic';

    const existing = await this.planRepo.findOne({ where: { slug } });
    if (existing) {
      return existing;
    }

    // الخطة غير موجودة — ننشئها
    const isProf = tier === PlanTier.PROFESSIONAL;
    const newPlan = this.planRepo.create({
      name: isProf ? 'احترافي' : 'أساسي',
      slug,
      type: 'paid' as any,
      status: 'active' as any,
      pricing: {
        currency: 'SAR',
        monthlyPrice: isProf ? 69 : 49,
        yearlyPrice: isProf ? 660 : 468,
        yearlyDiscount: 20,
      },
      features: {
        monthlyMessages: isProf ? 10000 : 1000,
        maxStores: isProf ? 10 : 3,
        maxUsers: isProf ? 10 : 3,
        maxWhatsAppChannels: isProf ? 5 : 2,
        maxInstagramChannels: isProf ? 3 : 1,
        maxDiscordChannels: isProf ? 2 : 1,
        maxActiveCampaigns: isProf ? 50 : 10,
        maxTemplates: isProf ? 100 : 20,
        storageLimit: isProf ? 5000 : 1000,
        aiSupport: isProf,
        advancedAnalytics: isProf,
        apiAccess: isProf,
        customWebhooks: isProf,
        dataExport: isProf,
        prioritySupport: isProf,
        dedicatedAccountManager: false,
        whiteLabel: false,
        ssoEnabled: false,
        auditLogs: isProf,
      },
      featureList: isProf
        ? ['10,000 رسالة/شهر', 'بوت الذكاء الاصطناعي', 'تحليلات متقدمة']
        : ['1,000 رسالة/شهر', 'إشعارات الطلبات', 'قوالب جاهزة'],
      trialDays: 0,
      displayOrder: isProf ? 2 : 1,
      isVisible: true,
      metadata: {},
    } as any);

    const saved = await this.planRepo.save(newPlan) as unknown as SubscriptionPlanEntity;
    this.logger.log(`📦 Created ${slug} plan in DB`);
    return saved;
  }

  private async activateSubscription(
    tenantId: string,
    plan: PlanTier,
    ctx: { source: string; externalId?: string; endDate?: string },
  ): Promise<void> {
    const planEntity = await this.findOrCreatePlan(plan);
    const now = new Date();
    const periodEnd = ctx.endDate ? new Date(ctx.endDate) : new Date(now.getTime() + 30 * 86400000);

    const usageStats: UsageStats = {
      messagesUsed: 0, messagesLimit: PLAN_MESSAGE_LIMITS[plan],
      storesCount: 0, storesLimit: PLAN_FEATURES[plan].maxStores,
      usersCount: 0, usersLimit: PLAN_FEATURES[plan].maxUsers,
      storageUsed: 0, storageLimit: 1000, lastUpdated: now.toISOString(),
    };

    let sub = await this.subscriptionRepo.findOne({ where: { tenantId }, order: { createdAt: 'DESC' } });

    if (sub) {
      sub.planId = planEntity.id;
      sub.status = SubscriptionStatus.ACTIVE;
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = periodEnd;
      sub.amount = planEntity.pricing?.monthlyPrice || 0;
      sub.usageStats = usageStats;
      // ✅ FIX: مسح تواريخ الإلغاء عند إعادة التفعيل
      sub.cancelledAt = null as any;
      sub.endsAt = null as any;
    } else {
      sub = this.subscriptionRepo.create({
        tenantId, planId: planEntity.id, status: SubscriptionStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY, startedAt: now,
        currentPeriodStart: now, currentPeriodEnd: periodEnd,
        currency: 'SAR', amount: planEntity.pricing?.monthlyPrice || 0,
        autoRenew: true, usageStats, paymentMethods: [],
        metadata: { activatedBy: ctx.source, externalId: ctx.externalId },
      } as unknown as Subscription);
    }

    await this.subscriptionRepo.save(sub);

    const tenantPlan = plan === PlanTier.PROFESSIONAL ? TenantPlanEnum.PRO : TenantPlanEnum.BASIC;
    await this.tenantRepo.update(tenantId, {
      subscriptionPlan: tenantPlan,
      status: TenantStatus.ACTIVE,
      monthlyMessageLimit: PLAN_MESSAGE_LIMITS[plan],
    });

    this.logger.log(`✅ Subscription activated: ${tenantId} → ${plan} (${ctx.source})`);
  }

  private async deactivateSubscription(tenantId: string, source: string): Promise<void> {
    await this.subscriptionRepo
      .createQueryBuilder().update(Subscription)
      .set({ status: SubscriptionStatus.CANCELLED, cancelledAt: new Date(), endsAt: new Date() })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status IN (:...s)', { s: ['active', 'trialing', 'past_due'] })
      .execute();

    await this.tenantRepo.update(tenantId, {
      subscriptionPlan: TenantPlanEnum.FREE,
      monthlyMessageLimit: 0,
    });

    this.logger.log(`❌ Subscription deactivated: ${tenantId} (${source})`);
  }
}
