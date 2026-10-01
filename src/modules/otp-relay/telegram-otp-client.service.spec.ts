import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { StringSession } from 'teleproto/sessions';
import { TelegramOtpClientService } from './telegram-otp-client.service';

describe('TelegramOtpClientService teleproto integration', () => {
  it('keeps the client disabled when the MTProto credentials are incomplete', async () => {
    const redis = {
      set: jest.fn(),
      eval: jest.fn(),
    } as unknown as Redis;
    const service = new TelegramOtpClientService(new ConfigService({}), redis);

    await service.onModuleInit();

    expect(service.isAvailable()).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('supports an empty StringSession for the existing admin sign-in flow', () => {
    const session = new StringSession('');

    expect(session.save()).toBe('');
  });
});
