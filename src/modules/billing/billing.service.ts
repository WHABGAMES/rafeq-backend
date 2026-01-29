/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Billing Service                            ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Service مسؤول عن:                                                   ║
 * ║  - إنشاء وإدارة الاشتراكات                                                     ║
 * ║  - التحقق من حالة الاشتراك                                                     ║
 * ║  - إنفاذ حدود الاستخدام                                                        ║
 * ║  - معالجة التجديد والإلغاء                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// Entities
import { Subscription, SubscriptionStatus, BillingInterval, PaymentProvider } from '@database/entities/subscription.entity';
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';

// DTOs
import {
  CreateSubscriptionDto,
  CancelSubscriptionDto,
  ChangeSubscriptionPlanDto,
} from './dto';

// Interfaces
import { UsageStats } from '@database/entities/subscription.entity';

/**
 * 🎯 BillingService
 * 
 * الخدمة الرئيسية لإدارة الفوترة والاشتراكات
 * 
 * @example
 * // إنشاء اشتراك جديد
 * const subscription = await billingService.createSubscription({
 *   tenantId: 'uuid',
 *   planId: 'uuid',
 *   billingInterval: BillingInterval.MONTHLY,
 * });
 * 
 * // التحقق من الحصة
 * await billingService.checkQuota(tenantId, 'messages', 100);
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    @InjectRepository(SubscriptionPlan)
    private readonly planRepo: Repository<SubscriptionPlan>,

    @InjectQueue('billing')
    private readonly billingQueue: Queue,

    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 SUBSCRIPTION MANAGEMENT - إدارة الاشتراكات
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔍 الحصول على اشتراك المستأجر
   * 
   * @param tenantId - معرف المستأجر
   * @returns الاشتراك الفعال أو null
   * 
   * @description
   * يبحث عن اشتراك فعال للمستأجر
   * الحالات الفعالة: trialing, active, past_due, cancelling
   */
  async getActiveSubscription(tenantId: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({
      where: {
        tenantId,
        status: SubscriptionStatus.ACTIVE,
      } as any,
      relations: ['plan'],
    });
  }

  /**
   * ➕ إنشاء اشتراك جديد
   * 
   * @param dto - بيانات الاشتراك
   * @returns الاشتراك الجديد
   * 
   * @description
   * الخطوات:
   * 1. التحقق من عدم وجود اشتراك فعال
   * 2. الحصول على تفاصيل الخطة
   * 3. إنشاء الاشتراك
   * 4. إرسال event للـ modules الأخرى
   */
  async createSubscription(dto: CreateSubscriptionDto): Promise<Subscription> {
    const { tenantId, planId, billingInterval, paymentProvider, billingInfo } = dto;

    // 1. التحقق من عدم وجود اشتراك فعال
    const existingSubscription = await this.getActiveSubscription(tenantId);
    if (existingSubscription) {
      throw new BadRequestException(
        'المستأجر لديه اشتراك فعال بالفعل. يرجى إلغاؤه أولاً أو تغيير الخطة.',
      );
    }

    // 2. الحصول على الخطة
    const plan = await this.planRepo.findOne({
      where: { id: planId, status: 'active' as any },
    });
    if (!plan) {
      throw new NotFoundException('الخطة غير موجودة أو غير متاحة');
    }

    // 3. حساب التواريخ
    const now = new Date();
    const trialEndsAt = plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
      : null;
    
    const periodEnd = this.calculatePeriodEnd(now, billingInterval);

    // 4. حساب السعر
    const pricing = this.calculatePricing(plan, billingInterval);

    // 5. إنشاء الاشتراك
    const subscriptionData = {
      tenantId,
      planId,
      status: trialEndsAt ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
      billingInterval,
      startedAt: now,
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      currency: pricing.currency,
      amount: pricing.amount,
      paymentProvider: paymentProvider || PaymentProvider.STRIPE,
      billingInfo: billingInfo || {},
      usageStats: this.initializeUsageStats(),
      autoRenew: true,
    };
    
    const subscription = this.subscriptionRepo.create(subscriptionData as unknown as Subscription);

    await this.subscriptionRepo.save(subscription);

    // 6. إرسال event
    this.eventEmitter.emit('subscription.created', {
      subscription,
      plan,
      tenantId,
    });

    // 7. جدولة مهام
    await this.scheduleSubscriptionTasks(subscription);

    this.logger.log(
      `✅ تم إنشاء اشتراك جديد للمستأجر ${tenantId} على خطة ${plan.name}`,
    );

    return subscription;
  }

  /**
   * 🔄 تغيير خطة الاشتراك
   * 
   * @param tenantId - معرف المستأجر
   * @param dto - بيانات التغيير
   * @returns الاشتراك المحدث
   * 
   * @description
   * سيناريوهات التغيير:
   * 1. Upgrade: الدفع الفوري للفرق
   * 2. Downgrade: التطبيق في نهاية الفترة
   */
  async changeSubscriptionPlan(
    tenantId: string,
    dto: ChangeSubscriptionPlanDto,
  ): Promise<Subscription> {
    const subscription = await this.getActiveSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundException('لا يوجد اشتراك فعال');
    }

    const newPlan = await this.planRepo.findOne({
      where: { id: dto.newPlanId, status: 'active' as any },
    });
    if (!newPlan) {
      throw new NotFoundException('الخطة الجديدة غير موجودة');
    }

    const currentPlan = await this.planRepo.findOne({
      where: { id: subscription.planId } as any,
    });

    // حساب الفرق
    const isUpgrade = (newPlan.pricing?.monthlyPrice || 0) > (currentPlan?.pricing?.monthlyPrice || 0);

    if (isUpgrade) {
      // Upgrade فوري
      subscription.planId = newPlan.id;
      subscription.amount = this.calculatePricing(
        newPlan,
        subscription.billingInterval,
      ).amount;

      // جدولة الدفع للفرق
      await this.billingQueue.add('process-proration', {
        subscriptionId: subscription.id,
        oldPlanId: currentPlan?.id,
        newPlanId: newPlan.id,
      });
    } else {
      // Downgrade في نهاية الفترة
      (subscription as any).metadata = {
        ...subscription.metadata,
        scheduledPlanChange: {
          newPlanId: newPlan.id,
          effectiveAt: subscription.currentPeriodEnd,
        },
      };
    }

    await this.subscriptionRepo.save(subscription);

    this.eventEmitter.emit('subscription.plan_changed', {
      subscription,
      oldPlan: currentPlan,
      newPlan,
      isUpgrade,
    });

    return subscription;
  }

  /**
   * ❌ إلغاء الاشتراك
   * 
   * @param tenantId - معرف المستأجر
   * @param dto - سبب الإلغاء
   * @returns الاشتراك المحدث
   */
  async cancelSubscription(
    tenantId: string,
    dto: CancelSubscriptionDto,
  ): Promise<Subscription> {
    const subscription = await this.getActiveSubscription(tenantId);
    if (!subscription) {
      throw new NotFoundException('لا يوجد اشتراك فعال');
    }

    const now = new Date();

    // تحديد نوع الإلغاء
    if (dto.immediate) {
      // إلغاء فوري
      subscription.status = SubscriptionStatus.CANCELLED;
      subscription.cancelledAt = now;
      subscription.endsAt = now;
    } else {
      // إلغاء في نهاية الفترة
      subscription.status = SubscriptionStatus.CANCELLING;
      subscription.cancelledAt = now;
      subscription.endsAt = subscription.currentPeriodEnd;
      subscription.autoRenew = false;
    }

    (subscription as any).metadata = {
      ...subscription.metadata,
      cancellationReason: dto.reason,
      notes: dto.feedback,
    };

    await this.subscriptionRepo.save(subscription);

    this.eventEmitter.emit('subscription.cancelled', {
      subscription,
      reason: dto.reason,
      immediate: dto.immediate,
    });

    this.logger.log(
      `❌ تم إلغاء اشتراك المستأجر ${tenantId}${dto.immediate ? ' فوراً' : ' في نهاية الفترة'}`,
    );

    return subscription;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 QUOTA MANAGEMENT - إدارة الحصص
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ التحقق من الحصة
   * 
   * @param tenantId - معرف المستأجر
   * @param resource - نوع المورد (messages, stores, users, etc.)
   * @param requested - الكمية المطلوبة
   * @returns true إذا كانت الحصة متاحة
   * @throws ForbiddenException إذا تجاوزت الحصة
   * 
   * @example
   * // قبل إرسال رسالة
   * await billingService.checkQuota(tenantId, 'messages', 1);
   */
  async checkQuota(
    tenantId: string,
    resource: keyof UsageStats,
    requested: number = 1,
  ): Promise<boolean> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId } as any as any,
      relations: ['plan'],
    });

    if (!subscription) {
      throw new ForbiddenException('لا يوجد اشتراك فعال');
    }

    // التحقق من حالة الاشتراك
    if (
      subscription.status === SubscriptionStatus.CANCELLED ||
      subscription.status === SubscriptionStatus.EXPIRED ||
      subscription.status === SubscriptionStatus.SUSPENDED
    ) {
      throw new ForbiddenException('الاشتراك غير فعال');
    }

    const plan = subscription.plan;
    if (!plan) {
      throw new ForbiddenException('لم يتم العثور على الخطة');
    }

    // الحصول على الحد الأقصى من الخطة
    const limit = this.getResourceLimit(plan, resource);
    
    // -1 يعني غير محدود
    if (limit === -1) {
      return true;
    }

    // الحصول على الاستخدام الحالي
    const currentUsage = Number(subscription.usageStats?.[resource] || 0);

    if (currentUsage + requested > limit) {
      throw new ForbiddenException({
        message: `تم تجاوز حد ${this.getResourceName(resource)}`,
        code: 'QUOTA_EXCEEDED',
        resource,
        limit,
        current: currentUsage,
        requested,
        upgradeUrl: '/billing/upgrade',
      });
    }

    return true;
  }

  /**
   * ➕ تسجيل استخدام
   * 
   * @param tenantId - معرف المستأجر
   * @param resource - نوع المورد
   * @param amount - الكمية (افتراضي 1)
   */
  async recordUsage(
    tenantId: string,
    resource: keyof UsageStats,
    amount: number = 1,
  ): Promise<void> {
    await this.subscriptionRepo
      .createQueryBuilder()
      .update()
      .set({
        usageStats: () =>
          `jsonb_set(
            COALESCE(usage_stats, '{}'::jsonb),
            '{${resource}}',
            (COALESCE((usage_stats->>'${resource}')::int, 0) + ${amount})::text::jsonb
          )`,
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status IN (:...statuses)', {
        statuses: [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.PAST_DUE,
        ],
      })
      .execute();
  }

  /**
   * 📊 الحصول على إحصائيات الاستخدام
   * 
   * @param tenantId - معرف المستأجر
   * @returns إحصائيات الاستخدام مع الحدود
   */
  async getUsageStats(tenantId: string): Promise<{
    usage: UsageStats;
    limits: Record<string, number>;
    percentages: Record<string, number>;
  }> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId } as any,
      relations: ['plan'],
    });

    if (!subscription || !subscription.plan) {
      return {
        usage: this.initializeUsageStats(),
        limits: {},
        percentages: {},
      };
    }

    const usage = subscription.usageStats || this.initializeUsageStats();
    const limits: Record<string, number> = {};
    const percentages: Record<string, number> = {};

    const resources: (keyof UsageStats)[] = [
      'messagesUsed',
      'storesCount',
      'usersCount',
      'storageUsed',
    ];

    for (const resource of resources) {
      const limit = this.getResourceLimit(subscription.plan, resource);
      limits[resource] = limit;
      const usageValue = Number(usage[resource] || 0);
      percentages[resource] = limit <= 0 ? 0 : Math.round((usageValue / limit) * 100);
    }

    return { usage, limits, percentages };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 RENEWAL & LIFECYCLE - التجديد ودورة الحياة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔄 تجديد الاشتراك
   * 
   * @param subscriptionId - معرف الاشتراك
   * 
   * @description
   * يُنفذ من خلال Cron Job أو بعد الدفع الناجح
   * 1. التحقق من إمكانية التجديد
   * 2. معالجة الدفع
   * 3. تحديث الفترة
   * 4. إعادة تعيين الاستخدام
   */
  async renewSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id: subscriptionId } as any,
      relations: ['plan'],
    });

    if (!subscription) {
      this.logger.warn(`⚠️ محاولة تجديد اشتراك غير موجود: ${subscriptionId}`);
      return;
    }

    if (!subscription.autoRenew) {
      this.logger.log(`⏸️ تجاهل تجديد اشتراك معطل التجديد التلقائي: ${subscriptionId}`);
      subscription.status = SubscriptionStatus.CANCELLED;
      await this.subscriptionRepo.save(subscription);
      return;
    }

    // معالجة الدفع (سيتم تنفيذها في PaymentService)
    // هنا نفترض أن الدفع تم بنجاح

    const now = new Date();
    const newPeriodEnd = this.calculatePeriodEnd(now, subscription.billingInterval);

    subscription.currentPeriodStart = now;
    subscription.currentPeriodEnd = newPeriodEnd;
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.usageStats = this.initializeUsageStats();  // إعادة تعيين

    await this.subscriptionRepo.save(subscription);

    this.eventEmitter.emit('subscription.renewed', { subscription });

    this.logger.log(`✅ تم تجديد الاشتراك ${subscriptionId}`);
  }

  /**
   * ⏰ معالجة الاشتراكات المنتهية
   * 
   * يُنفذ من Cron Job يومياً
   */
  async processExpiredSubscriptions(): Promise<void> {
    const now = new Date();

    // 1. تحويل trialing إلى active أو expired
    const endedTrials = await this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndsAt: LessThan(now),
      } as any,
    });

    for (const subscription of endedTrials) {
      if (subscription.paymentMethods?.length > 0) {
        subscription.status = SubscriptionStatus.ACTIVE;
      } else {
        subscription.status = SubscriptionStatus.EXPIRED;
        subscription.endsAt = now;
      }
      await this.subscriptionRepo.save(subscription);
    }

    // 2. تحويل cancelling إلى cancelled
    const toCancel = await this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.CANCELLING,
        endsAt: LessThan(now),
      } as any,
    });

    for (const subscription of toCancel) {
      subscription.status = SubscriptionStatus.CANCELLED;
      await this.subscriptionRepo.save(subscription);
    }

    // 3. تحويل past_due إلى suspended بعد 7 أيام
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toSuspend = await this.subscriptionRepo.find({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        currentPeriodEnd: LessThan(sevenDaysAgo),
      } as any,
    });

    for (const subscription of toSuspend) {
      subscription.status = SubscriptionStatus.SUSPENDED;
      await this.subscriptionRepo.save(subscription);
      this.eventEmitter.emit('subscription.suspended', { subscription });
    }

    this.logger.log(
      `⏰ معالجة الاشتراكات: ${endedTrials.length} trial, ${toCancel.length} cancelled, ${toSuspend.length} suspended`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ HELPER METHODS - الدوال المساعدة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📅 حساب نهاية الفترة
   */
  private calculatePeriodEnd(start: Date, interval: BillingInterval): Date {
    const date = new Date(start);
    switch (interval) {
      case BillingInterval.MONTHLY:
        date.setMonth(date.getMonth() + 1);
        break;
      case BillingInterval.YEARLY:
        date.setFullYear(date.getFullYear() + 1);
        break;
    }
    return date;
  }

  /**
   * 💰 حساب السعر
   */
  private calculatePricing(
    plan: SubscriptionPlan,
    interval: BillingInterval,
  ): { amount: number; currency: string } {
    const pricing = plan.pricing;
    if (!pricing) {
      return { amount: 0, currency: 'SAR' };
    }

    if (interval === BillingInterval.YEARLY) {
      return {
        amount: pricing.yearlyPrice || (pricing.monthlyPrice || 0) * 12 * 0.8,  // خصم 20%
        currency: pricing.currency || 'SAR',
      };
    }

    return {
      amount: pricing.monthlyPrice || 0,
      currency: pricing.currency || 'SAR',
    };
  }

  /**
   * 📊 الحصول على حد المورد
   */
  private getResourceLimit(
    plan: SubscriptionPlan,
    resource: keyof UsageStats,
  ): number {
    const features = plan.features;
    if (!features) {
      return 0;
    }

    const resourceMap: Partial<Record<keyof UsageStats, string>> = {
      messagesUsed: 'monthlyMessages',
      storesCount: 'maxStores',
      usersCount: 'maxUsers',
      storageUsed: 'storageLimit',
    };

    const key = resourceMap[resource];
    if (!key) return 0;
    
    const limit = (features as any)[key];

    return limit ?? 0;
  }

  /**
   * 📝 الحصول على اسم المورد بالعربية
   */
  private getResourceName(resource: keyof UsageStats): string {
    const names: Partial<Record<keyof UsageStats, string>> = {
      messagesUsed: 'الرسائل الشهرية',
      storesCount: 'المتاجر',
      usersCount: 'المستخدمين',
      storageUsed: 'مساحة التخزين',
    };
    return names[resource] || String(resource);
  }

  /**
   * 🔢 تهيئة إحصائيات الاستخدام
   */
  private initializeUsageStats(): UsageStats {
    return {
      messagesUsed: 0,
      messagesLimit: 5000,
      storesCount: 0,
      storesLimit: 5,
      usersCount: 0,
      usersLimit: 10,
      storageUsed: 0,
      storageLimit: 1000,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * ⏰ جدولة مهام الاشتراك
   */
  private async scheduleSubscriptionTasks(subscription: Subscription): Promise<void> {
    // تذكير قبل انتهاء التجربة بـ 3 أيام
    if (subscription.trialEndsAt) {
      const reminderDate = new Date(subscription.trialEndsAt.getTime() - 3 * 24 * 60 * 60 * 1000);
      if (reminderDate > new Date()) {
        await this.billingQueue.add(
          'trial-ending-reminder',
          { subscriptionId: subscription.id },
          { delay: reminderDate.getTime() - Date.now() },
        );
      }
    }

    // تذكير قبل التجديد بـ 7 أيام
    if (subscription.currentPeriodEnd) {
      const renewalReminder = new Date(
        subscription.currentPeriodEnd.getTime() - 7 * 24 * 60 * 60 * 1000,
      );
      if (renewalReminder > new Date()) {
        await this.billingQueue.add(
          'renewal-reminder',
          { subscriptionId: subscription.id },
          { delay: renewalReminder.getTime() - Date.now() },
        );
      }
    }
  }
}
