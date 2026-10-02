import { UnauthorizedException } from '@nestjs/common';
import { ZidOAuthService } from '../zid-oauth.service';

describe('ZidOAuthService state transactions', () => {
  const values = new Map<string, string>();
  const redis = {
    setex: jest.fn(async (key: string, _ttl: number, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    eval: jest.fn(async (_script: string, _keys: number, key: string) => {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    }),
  };
  const config = {
    get: jest.fn((key: string) => ({
      'zid.clientId': 'client-id',
      'zid.oauthCallbackUrl': 'https://api.rafeq.ai/api/stores/zid/callback',
    })[key]),
  };

  const createService = () => new ZidOAuthService(
    config as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    redis as never,
  );

  beforeEach(() => {
    values.clear();
    jest.clearAllMocks();
  });

  it('stores a dashboard transaction in Redis and consumes it once', async () => {
    const service = createService();
    const url = new URL(await service.generateAuthorizationUrl('tenant-id'));
    const state = url.searchParams.get('state');

    expect(state).toBeTruthy();
    expect(await service.consumeState(state!)).toEqual({ mode: 'dashboard', tenantId: 'tenant-id' });
    await expect(service.consumeState(state!)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('marks App Market activation as an install transaction', async () => {
    const service = createService();
    const url = new URL(await service.generateInstallAuthorizationUrl());
    const state = url.searchParams.get('state');

    expect(await service.consumeState(state!)).toEqual({ mode: 'install' });
  });
});
