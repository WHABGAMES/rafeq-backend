import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  it('does not duplicate the primary recipient as BCC', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'BCC_EMAIL') return 'OWNER@example.com';
        return fallback;
      }),
    } as unknown as ConfigService;
    const service = new MailService(config);
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-message' });
    Object.defineProperty(service, 'transporter', {
      value: { sendMail },
      configurable: true,
    });

    await expect(service.sendMail({
      to: 'owner@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).resolves.toBe(true);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      bcc: undefined,
    }));
  });
});
