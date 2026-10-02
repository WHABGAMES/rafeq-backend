import { Job } from 'bullmq';
import { NotificationJobData, NotificationProcessor } from './notification.processor';

describe('NotificationProcessor admin alert delivery accounting', () => {
  const whatsappService = { sendMessage: jest.fn() };
  const dataSource = { query: jest.fn() };
  const mailService = { sendMail: jest.fn() };
  const processor = new NotificationProcessor(
    whatsappService as never,
    dataSource as never,
    mailService as never,
  );

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

  it('delivers email through MailService and records template usage only after success', async () => {
    mailService.sendMail.mockResolvedValue(true);
    dataSource.query.mockResolvedValue([]);
    const job = {
      id: 'job-email',
      attemptsMade: 0,
      data: {
        templateId: 'template-1',
        content: '<script>alert(1)</script>\nWelcome',
        subject: 'Welcome',
        channel: 'email',
        recipientEmail: 'merchant@example.com',
      },
    } as Job<NotificationJobData>;

    await processor.process(job);

    expect(mailService.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'merchant@example.com',
      subject: 'Welcome',
      html: expect.stringContaining('&lt;script&gt;'),
    }));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('sent_count = sent_count + 1'),
      ['template-1'],
    );
  });

  it('does not record template usage when the provider rejects delivery', async () => {
    mailService.sendMail.mockResolvedValue(false);
    const job = {
      id: 'job-email-failed',
      attemptsMade: 0,
      data: {
        templateId: 'template-1',
        content: 'Welcome',
        channel: 'email',
        recipientEmail: 'merchant@example.com',
      },
    } as Job<NotificationJobData>;

    await expect(processor.process(job)).rejects.toThrow('Email provider rejected');
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
