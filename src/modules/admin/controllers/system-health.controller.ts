import { Controller, Get, UseGuards, Inject, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { PERMISSIONS } from '../entities/admin-user.entity';

/**
 * System Health Controller
 *
 * Redis health is checked via BullMQ queue client (no extra IORedis dependency needed).
 * If your app uses @nestjs-modules/ioredis globally, you can optionally inject it via:
 *   @Optional() @Inject('default_IORedisModuleConnectionToken') private readonly redis?: any
 */
@Controller('admin/system')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@RequirePermissions(PERMISSIONS.SYSTEM_METRICS)
export class SystemHealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    // ✅ Use BullMQ's built-in Redis client — no separate IORedis module required
    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,
  ) {}

  @Get('health')
  async getSystemHealth() {
    const [dbStatus, redisStatus] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus.status === 'fulfilled' ? dbStatus.value : { status: 'error', error: (dbStatus as PromiseRejectedResult).reason?.message },
        redis: redisStatus.status === 'fulfilled' ? redisStatus.value : { status: 'error', error: (redisStatus as PromiseRejectedResult).reason?.message },
      },
    };
  }

  @Get('metrics')
  async getMetrics() {
    const [userStats, storeStats, messageStats, subscriptionStats] =
      await Promise.all([
        this.getUserStats(),
        this.getStoreStats(),
        this.getMessageStats(),
        this.getSubscriptionStats(),
      ]);

    return {
      timestamp: new Date().toISOString(),
      users: userStats,
      stores: storeStats,
      messages: messageStats,
      subscriptions: subscriptionStats,
    };
  }

  private async checkDatabase() {
    const start = Date.now();
    await this.dataSource.query('SELECT 1');
    return {
      status: 'ok',
      responseTimeMs: Date.now() - start,
    };
  }

  private async checkRedis() {
    const start = Date.now();

    // ✅ Use BullMQ's internal Redis client — always available
    const client = await this.notificationQueue.client;
    await client.ping();

    // Get Redis server info
    const info = await client.info('server');
    const version = info.match(/redis_version:(.+)/)?.[1]?.trim();

    return {
      status: 'ok',
      responseTimeMs: Date.now() - start,
      version,
    };
  }

  private async getUserStats() {
    const [result] = await this.dataSource.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'inactive') as suspended,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week,
        COUNT(*) as total
      FROM users
    `);
    return {
      total: +result.total,
      active: +result.active,
      suspended: +result.suspended,
      newThisWeek: +result.new_this_week,
    };
  }

  private async getStoreStats() {
    const [result] = await this.dataSource.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
        COUNT(*) as total
      FROM stores
    `);
    return {
      total: +result.total,
      active: +result.active,
      suspended: +result.suspended,
    };
  }

  private async getMessageStats() {
    const [result] = await this.dataSource.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
      FROM message_logs
    `);
    return {
      totalSent: +result.sent,
      totalFailed: +result.failed,
      last24h: +result.last_24h,
    };
  }

  private async getSubscriptionStats() {
    // Gracefully handle case where subscriptions table may not exist
    try {
      const [result] = await this.dataSource.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'trial') as trial,
          COUNT(*) FILTER (WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '7 days') as expiring_soon
        FROM subscriptions
      `);
      return {
        active: +result.active,
        trial: +result.trial,
        expiringSoon: +result.expiring_soon,
      };
    } catch {
      return { active: 0, trial: 0, expiringSoon: 0 };
    }
  }
}
