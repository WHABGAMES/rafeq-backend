import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import {
  Subscription,
  SubscriptionStatus,
} from '@database/entities/subscription.entity';
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';
import { PaymentService } from './payment.service';

describe('PaymentService payment safety', () => {
  const subscriptionRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const planRepository = {
    findOne: jest.fn(),
  };

  const createService = (environment: string): PaymentService => {
    const configService = {
      get: jest.fn().mockReturnValue(environment),
    } as unknown as ConfigService;

    return new PaymentService(
      configService,
      subscriptionRepository as unknown as Repository<Subscription>,
      planRepository as unknown as Repository<SubscriptionPlan>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed instead of issuing a fake production checkout', async () => {
    planRepository.findOne.mockResolvedValue(new SubscriptionPlan());

    await expect(createService('production').createCheckoutSession({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      successUrl: 'https://rafeq.ai/success',
      cancelUrl: 'https://rafeq.ai/cancel',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps the mock checkout restricted to development', async () => {
    planRepository.findOne.mockResolvedValue(new SubscriptionPlan());

    const result = await createService('development').createCheckoutSession({
      tenantId: 'tenant-1',
      planId: 'plan-1',
      successUrl: 'https://rafeq.ai/success',
      cancelUrl: 'https://rafeq.ai/cancel',
    });

    expect(result.sessionId).toMatch(/^mock_session_/);
    expect(result.url).toBe('https://rafeq.ai/success');
  });

  it('marks an unpaid paid renewal as past due without extending its dates', async () => {
    const periodStart = new Date('2026-09-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const subscription = Object.assign(new Subscription(), {
      id: 'subscription-1',
      amount: 49,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });
    subscriptionRepository.findOne.mockResolvedValue(subscription);
    subscriptionRepository.save.mockImplementation(async (value: Subscription) => value);

    await expect(createService('production').renewSubscription(subscription.id))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(subscription.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(subscription.currentPeriodStart).toBe(periodStart);
    expect(subscription.currentPeriodEnd).toBe(periodEnd);
    expect(subscriptionRepository.save).toHaveBeenCalledWith(subscription);
  });
});
