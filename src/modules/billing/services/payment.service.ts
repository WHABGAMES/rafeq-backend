/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Payment Service                                  ║
 * ║                                                                                ║
 * ║  📌 التكامل مع بوابات الدفع (Stripe, Moyasar)                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Subscription } from '@database/entities/subscription.entity';
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';

export interface CreateCheckoutSession {
  tenantId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
  ) {}

  /**
   * إنشاء جلسة دفع
   */
  async createCheckoutSession(
    data: CreateCheckoutSession,
  ): Promise<CheckoutResult> {
    const plan = await this.planRepository.findOne({
      where: { id: data.planId } as any,
    });

    if (!plan) {
      throw new BadRequestException('الخطة غير موجودة');
    }

    // في بيئة التطوير، نُرجع mock
    if (this.configService.get('NODE_ENV') === 'development') {
      return {
        sessionId: `mock_session_${Date.now()}`,
        url: data.successUrl,
      };
    }

    // TODO: التكامل مع Stripe أو Moyasar
    // const stripe = new Stripe(this.configService.get('STRIPE_SECRET_KEY'));
    // const session = await stripe.checkout.sessions.create({...});

    return {
      sessionId: `session_${Date.now()}`,
      url: data.successUrl,
    };
  }

  /**
   * معالجة نجاح الدفع
   */
  async handlePaymentSuccess(
    _sessionId: string,
    tenantId: string,
    planId: string,
  ): Promise<Subscription> {
    const plan = await this.planRepository.findOne({
      where: { id: planId } as any,
    });

    if (!plan) {
      throw new BadRequestException('الخطة غير موجودة');
    }

    // البحث عن اشتراك موجود أو إنشاء جديد
    let subscription = await this.subscriptionRepository.findOne({
      where: { tenantId } as any,
    });

    const now = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1); // شهر واحد

    if (subscription) {
      // تحديث الاشتراك الموجود
      subscription.planId = planId;
      subscription.status = 'active' as any;
      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = endDate;
    } else {
      // إنشاء اشتراك جديد
      subscription = this.subscriptionRepository.create({
        tenantId,
        planId,
        status: 'active' as any,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        usageStats: {
          messagesUsed: 0,
          messagesLimit: 5000,
          storesCount: 0,
          storesLimit: 5,
          usersCount: 0,
          usersLimit: 10,
          storageUsed: 0,
          storageLimit: 1000,
          lastUpdated: new Date().toISOString(),
        },
      });
    }

    return this.subscriptionRepository.save(subscription);
  }

  /**
   * إلغاء الاشتراك
   */
  async cancelSubscription(tenantId: string): Promise<void> {
    await this.subscriptionRepository.update(
      { tenantId } as any,
      { 
        status: 'cancelled' as any,
        cancelledAt: new Date(),
      } as any,
    );
  }

  /**
   * تجديد الاشتراك تلقائياً
   */
  async renewSubscription(subscriptionId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId } as any,
    });

    if (!subscription) {
      throw new BadRequestException('الاشتراك غير موجود');
    }

    const now = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    subscription.currentPeriodStart = now;
    subscription.currentPeriodEnd = endDate;
    subscription.usageStats = {
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

    return this.subscriptionRepository.save(subscription);
  }
}
