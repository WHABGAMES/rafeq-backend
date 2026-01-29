/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Usage Tracking Service                           ║
 * ║                                                                                ║
 * ║  📌 تتبع استخدام المستأجرين للموارد                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Subscription } from '@database/entities/subscription.entity';

export interface UsageReport {
  messagesUsed: number;
  messagesLimit: number;
  messagesRemaining: number;
  conversationsUsed: number;
  conversationsLimit: number;
  aiCallsUsed: number;
  aiCallsLimit: number;
  percentageUsed: number;
}

@Injectable()
export class UsageTrackingService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
  ) {}

  /**
   * جلب تقرير الاستخدام
   */
  async getUsageReport(tenantId: string): Promise<UsageReport> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { tenantId, status: 'active' as any },
      relations: ['plan'],
    });

    if (!subscription) {
      return {
        messagesUsed: 0,
        messagesLimit: 1000,
        messagesRemaining: 1000,
        conversationsUsed: 0,
        conversationsLimit: 100,
        aiCallsUsed: 0,
        aiCallsLimit: 500,
        percentageUsed: 0,
      };
    }

    const messagesUsed = subscription.usageStats?.messagesUsed || 0;
    const messagesLimit = subscription.usageStats?.messagesLimit || 1000;
    
    return {
      messagesUsed,
      messagesLimit,
      messagesRemaining: Math.max(0, messagesLimit - messagesUsed),
      conversationsUsed: subscription.usageStats?.storesCount || 0,
      conversationsLimit: subscription.usageStats?.storesLimit || 100,
      aiCallsUsed: subscription.usageStats?.usersCount || 0,
      aiCallsLimit: subscription.usageStats?.usersLimit || 500,
      percentageUsed: Math.round((messagesUsed / messagesLimit) * 100),
    };
  }

  /**
   * زيادة عداد الرسائل
   */
  async incrementMessages(tenantId: string, count: number = 1): Promise<void> {
    await this.checkAndIncrement(tenantId, 'messages', count);
  }

  /**
   * زيادة عداد المحادثات
   */
  async incrementConversations(tenantId: string): Promise<void> {
    await this.checkAndIncrement(tenantId, 'conversations', 1);
  }

  /**
   * زيادة عداد استدعاءات AI
   */
  async incrementAiCalls(tenantId: string): Promise<void> {
    await this.checkAndIncrement(tenantId, 'aiCalls', 1);
  }

  /**
   * التحقق من الحد وزيادة العداد
   */
  private async checkAndIncrement(
    tenantId: string,
    field: string,
    amount: number,
  ): Promise<void> {
    await this.subscriptionRepository
      .createQueryBuilder()
      .update(Subscription)
      .set({
        usageStats: () =>
          `jsonb_set(usage_stats, '{${field}}', (COALESCE((usage_stats->>'${field}')::int, 0) + ${amount})::text::jsonb)`,
      })
      .where('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: 'active' })
      .execute();
  }

  /**
   * إعادة تعيين الاستخدام الشهري
   */
  async resetMonthlyUsage(tenantId: string): Promise<void> {
    await this.subscriptionRepository.update(
      { tenantId, status: 'active' as any },
      {
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
      },
    );
  }

  /**
   * التحقق من إمكانية إرسال رسالة
   */
  async canSendMessage(tenantId: string): Promise<boolean> {
    const usage = await this.getUsageReport(tenantId);
    return usage.messagesRemaining > 0;
  }
}
