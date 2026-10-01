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

  it('round-trips the persisted GramJS StringSession wire format', async () => {
    const dcId = Buffer.from([2]);
    const address = Buffer.from('149.154.167.51');
    const addressLength = Buffer.alloc(2);
    addressLength.writeInt16BE(address.length);
    const port = Buffer.alloc(2);
    port.writeInt16BE(443);
    const fakeAuthKey = Buffer.alloc(256, 0x5a);
    const persistedSession = `1${Buffer.concat([
      dcId,
      addressLength,
      address,
      port,
      fakeAuthKey,
    ]).toString('base64')}`;

    const session = new StringSession(persistedSession);
    await session.load();

    expect(session.save()).toBe(persistedSession);
  });
});
