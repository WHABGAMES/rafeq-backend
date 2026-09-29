/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Payment Service                                  ║
 * ║                                                                                ║
 * ║  📌 التكامل مع بوابات الدفع (Stripe, Moyasar)                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Subscription,
  SubscriptionStatus,
} from '@database/entities/subscription.entity';
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
      where: { id: data.planId },
    });

    if (!plan) {
      throw new BadRequestException('الخطة غير موجودة');
    }

    // في بيئة التطوير، نُرجع mock
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      return {
        sessionId: `mock_session_${Date.now()}`,
        url: data.successUrl,
      };
    }

    throw new ServiceUnavailableException(
      'بوابة الدفع غير مهيأة في الإنتاج؛ لم يتم إنشاء جلسة دفع وهمية.',
    );
  }

  /**
   * تجديد الاشتراك تلقائياً
   */
  async renewSubscription(subscriptionId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
      relations: ['plan'],
    });

    if (!subscription) {
      throw new BadRequestException('الاشتراك غير موجود');
    }

    if (Number(subscription.amount) > 0) {
      subscription.status = SubscriptionStatus.PAST_DUE;
      await this.subscriptionRepository.save(subscription);
      throw new ServiceUnavailableException(
        'تعذر التجديد: لا توجد بوابة دفع مهيأة للتحقق من التحصيل.',
      );
    }

    const now = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    subscription.currentPeriodStart = now;
    subscription.currentPeriodEnd = endDate;
    const features = subscription.plan?.features;
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.usageStats = {
      messagesUsed: 0,
      messagesLimit: features?.monthlyMessages ?? 0,
      storesCount: 0,
      storesLimit: features?.maxStores ?? 0,
      usersCount: 0,
      usersLimit: features?.maxUsers ?? 0,
      storageUsed: 0,
      storageLimit: features?.storageLimit ?? 0,
      lastUpdated: new Date().toISOString(),
    };

    return this.subscriptionRepository.save(subscription);
  }
}
