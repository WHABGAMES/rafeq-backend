import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import Redis from 'ioredis';

export type OAuthPlatform = 'google' | 'salla' | 'zid';

/**
 * One-time OAuth transaction state. The browser also receives the same opaque
 * value in an httpOnly SameSite cookie; a callback must present both values.
 */
@Injectable()
export class OAuthStateService {
  private static readonly PREFIX = 'rafiq:oauth-state:';
  private static readonly TTL_SECONDS = 10 * 60;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async create(platform: OAuthPlatform): Promise<string> {
    const state = crypto.randomBytes(32).toString('base64url');
    await this.redis.setex(`${OAuthStateService.PREFIX}${state}`, OAuthStateService.TTL_SECONDS, platform);
    return state;
  }

  async consume(state: string, platform: OAuthPlatform): Promise<void> {
    const key = `${OAuthStateService.PREFIX}${state}`;
    const result = await this.redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      key,
    );

    if (result !== platform) {
      throw new UnauthorizedException('جلسة تفويض OAuth غير صالحة أو منتهية');
    }
  }
}
