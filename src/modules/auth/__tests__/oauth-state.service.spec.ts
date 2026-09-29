import { UnauthorizedException } from '@nestjs/common';
import { OAuthStateService } from '../oauth-state.service';

describe('OAuthStateService', () => {
  const redis = {
    setex: jest.fn(),
    eval: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an opaque, short-lived transaction for the requested provider', async () => {
    const service = new OAuthStateService(redis as never);

    const state = await service.create('salla');

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redis.setex).toHaveBeenCalledWith(`rafiq:oauth-state:${state}`, 600, 'salla');
  });

  it('accepts a state only for its original provider', async () => {
    redis.eval.mockResolvedValueOnce('zid');
    const service = new OAuthStateService(redis as never);

    await expect(service.consume('state', 'zid')).resolves.toBeUndefined();
  });

  it('rejects replayed, expired, and cross-provider states', async () => {
    redis.eval.mockResolvedValueOnce(null).mockResolvedValueOnce('salla');
    const service = new OAuthStateService(redis as never);

    await expect(service.consume('replayed-state', 'salla')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.consume('salla-state', 'zid')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
