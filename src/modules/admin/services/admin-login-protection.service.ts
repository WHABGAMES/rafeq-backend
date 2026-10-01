import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Redis } from 'ioredis';

const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES_PER_ACCOUNT = 10;

@Injectable()
export class AdminLoginProtectionService {
  private readonly logger = new Logger(AdminLoginProtectionService.name);

  constructor(@Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis) {}

  async assertAllowed(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      const attempts = Number(await this.redis.get(this.key(email)) || 0);
      if (attempts >= MAX_FAILURES_PER_ACCOUNT) {
        throw new HttpException(
          'Too many login attempts. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn('Account login limiter is unavailable; IP throttling remains active');
    }
  }

  async recordFailure(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      const key = this.key(email);
      const attempts = await this.redis.incr(key);
      if (attempts === 1) await this.redis.expire(key, WINDOW_SECONDS);
    } catch {
      this.logger.warn('Could not record an admin login failure in Redis');
    }
  }

  async clearFailures(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.key(email));
    } catch {
      this.logger.warn('Could not clear the admin login limiter in Redis');
    }
  }

  private key(email: string): string {
    const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    return `admin_login_failures:${digest}`;
  }
}
