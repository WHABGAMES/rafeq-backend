jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_DAY_AT_9AM: '0 0 9 * * *' },
}));

import { TriggerEvent } from '../entities/message-template.entity';
import { NotificationEventListener } from './notification-event.listener';

describe('NotificationEventListener', () => {
  const notificationService = { sendByTriggerEvent: jest.fn() };
  const dataSource = { query: jest.fn() };
  const listener = new NotificationEventListener(
    notificationService as never,
    dataSource as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps email delivery available when a new user has no phone', async () => {
    await listener.handleUserCreated({
      userId: 'user-1',
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'Example',
      tenantId: 'tenant-1',
    });

    expect(notificationService.sendByTriggerEvent).toHaveBeenCalledWith(
      TriggerEvent.NEW_MERCHANT_REGISTERED,
      undefined,
      expect.objectContaining({ email: 'owner@example.com' }),
      expect.objectContaining({ recipientEmail: 'owner@example.com' }),
    );
  });

  it('resolves the tenant owner before dispatching an expired-subscription template', async () => {
    dataSource.query.mockResolvedValue([{
      user_id: 'owner-1',
      email: 'owner@example.com',
      phone: null,
      first_name: 'Owner',
      plan_name: 'Pro',
    }]);
    const expiredAt = new Date('2026-10-03T00:00:00.000Z');

    await listener.handleSubscriptionExpired({ tenantId: 'tenant-1', expiredAt });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("u.role = 'owner'"),
      ['tenant-1'],
    );
    expect(notificationService.sendByTriggerEvent).toHaveBeenCalledWith(
      TriggerEvent.SUBSCRIPTION_EXPIRED,
      undefined,
      expect.objectContaining({ plan_name: 'Pro', expiry_date: '2026-10-03' }),
      expect.objectContaining({
        recipientUserId: 'owner-1',
        recipientEmail: 'owner@example.com',
        tenantId: 'tenant-1',
      }),
    );
  });
});
