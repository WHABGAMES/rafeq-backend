import { Job } from 'bullmq';
import { NotificationJobData, NotificationProcessor } from './notification.processor';

describe('NotificationProcessor admin alert delivery accounting', () => {
  const whatsappService = { sendMessage: jest.fn() };
  const dataSource = { query: jest.fn() };
  const processor = new NotificationProcessor(whatsappService as never, dataSource as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not resend an already delivered alert when only metric persistence fails', async () => {
    whatsappService.sendMessage.mockResolvedValue({ success: true });
    dataSource.query.mockRejectedValue(new Error('metrics database unavailable'));
    const job = {
      id: 'job-1',
      attemptsMade: 0,
      data: {
        content: 'alert',
        channel: 'whatsapp',
        recipientPhone: '+96550000000',
        adminAlertRecipientId: 'recipient-1',
      },
    } as Job<NotificationJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(whatsappService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('records a delivery failure only after the final BullMQ attempt', async () => {
    const job = {
      attemptsMade: 2,
      opts: { attempts: 3 },
      data: { content: 'alert', channel: 'whatsapp', adminAlertRecipientId: 'recipient-1' },
    } as Job<NotificationJobData>;

    await processor.onFailed(job, new Error('temporary failure'));
    expect(dataSource.query).not.toHaveBeenCalled();

    job.attemptsMade = 3;
    dataSource.query.mockResolvedValue([]);
    await processor.onFailed(job, new Error('final failure'));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('failed_count = failed_count + 1'),
      ['recipient-1', 'final failure'],
    );
  });
});
