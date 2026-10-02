import { AdminAlertsService } from './admin-alerts.service';

describe('AdminAlertsService', () => {
  const recipientRepo = {};
  const notificationQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  const dataSource = { query: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('exposes only event types that have real producers', () => {
    const service = new AdminAlertsService(recipientRepo as never, notificationQueue as never, dataSource as never);
    const keys = service.getAvailableEvents().map(event => event.key);
    expect(keys).toContain('suggestion.created');
    expect(keys).not.toContain('system.incident');
    expect(keys).not.toContain('security.incident');
  });

  it('queues a typed recipient job and records queueing separately from delivery', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: 'recipient-1', name: 'Ops', phone: '+96550000000' }])
      .mockResolvedValueOnce([]);
    const service = new AdminAlertsService(recipientRepo as never, notificationQueue as never, dataSource as never);

    await service.dispatchEvent('subscription.created', {
      tenantId: 'tenant-1',
      plan: { name: 'Pro' },
      subscription: { amount: 25 },
    });

    expect(notificationQueue.add).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({
        adminAlertRecipientId: 'recipient-1',
        content: expect.stringContaining('Pro'),
      }),
      expect.any(Object),
    );
    expect(notificationQueue.add.mock.calls[0][1].content).not.toContain('[object Object]');
    expect(dataSource.query).toHaveBeenLastCalledWith(
      expect.stringContaining('queued_count = queued_count + 1'),
      ['recipient-1'],
    );
  });
});
