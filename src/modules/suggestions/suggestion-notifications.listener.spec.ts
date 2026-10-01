import { ConfigService } from '@nestjs/config';
import { SuggestionNotificationsListener } from './suggestion-notifications.listener';

describe('SuggestionNotificationsListener', () => {
  it('notifies unique active followers without exposing HTML from suggestion titles', async () => {
    const followerRepo = {
      find: jest.fn().mockResolvedValue([
        { merchantId: 'user-1' },
        { merchantId: 'user-1' },
        { merchantId: 'user-2' },
      ]),
    };
    const userRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'user-1', email: 'one@example.com', firstName: 'One' },
        { id: 'user-2', email: 'two@example.com', firstName: 'Two' },
      ]),
    };
    const mailService = { sendMail: jest.fn().mockResolvedValue(true) };
    const listener = new SuggestionNotificationsListener(
      followerRepo as never,
      userRepo as never,
      mailService as never,
      new ConfigService({ FRONTEND_URL: 'https://rafeq.ai/' }),
    );

    await listener.onAdminReply({
      suggestionId: 'suggestion-1',
      suggestionTitle: '<script>alert(1)</script>',
    });

    expect(mailService.sendMail).toHaveBeenCalledTimes(2);
    expect(mailService.sendMail.mock.calls[0][0].html).toContain('&lt;script&gt;');
    expect(mailService.sendMail.mock.calls[0][0].html).not.toContain('<script>');
    expect(mailService.sendMail.mock.calls[0][0].html).toContain('https://rafeq.ai/dashboard/suggestions');
  });

  it('does nothing when the suggestion has no followers', async () => {
    const mailService = { sendMail: jest.fn() };
    const listener = new SuggestionNotificationsListener(
      { find: jest.fn().mockResolvedValue([]) } as never,
      { find: jest.fn() } as never,
      mailService as never,
      new ConfigService(),
    );

    await listener.onStatusChanged({
      suggestionId: 'suggestion-1',
      suggestionTitle: 'اقتراح',
      newStatus: 'completed',
    });

    expect(mailService.sendMail).not.toHaveBeenCalled();
  });
});
