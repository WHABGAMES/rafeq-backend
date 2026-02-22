/**
 * SystemHealthController
 * Fixed 2026-02-21
 *
 * FIX [500]: Wrapped all DB queries in try/catch with fallback zeros
 * Any missing table (message_logs, stores, subscriptions) returns 0 gracefully
 * instead of crashing the entire /metrics endpoint with 500.
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { PERMISSIONS } from '../entities/admin-user.entity';

@Controller('admin/system')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@RequirePermissions(PERMISSIONS.SYSTEM_METRICS)
export class SystemHealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectQueue('notifications')
    private readonly notificationQueue: Queue,
  ) {}

  // ─── GET /admin/system/health ─────────────────────────────────────────────

  @Get('health')
  async getSystemHealth() {
    const [dbStatus, redisStatus] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const db =
      dbStatus.status === 'fulfilled'
        ? dbStatus.value
        : { status: 'error', error: (dbStatus as PromiseRejectedResult).reason?.message };

    const redis =
      redisStatus.status === 'fulfilled'
        ? redisStatus.value
        : { status: 'error', error: (redisStatus as PromiseRejectedResult).reason?.message };

    return {
      timestamp: new Date().toISOString(),
      overall: db.status === 'ok' && redis.status === 'ok' ? 'healthy' : 'degraded',
      services: { database: db, redis },
    };
  }

  // ─── GET /admin/system/metrics ────────────────────────────────────────────

  @Get('metrics')
  async getMetrics() {
    // ✅ كل query مستقلة — فشل واحد لا يؤثر على البقية
    const [userStats, storeStats, messageStats, subscriptionStats] = await Promise.all([
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

  // ─── Private: Health Checks ───────────────────────────────────────────────

  private async checkDatabase() {
    const start = Date.now();
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', responseTimeMs: Date.now() - start };
  }

  private async checkRedis() {
    const start = Date.now();
    try {
      const client = await this.notificationQueue.client;
      await client.ping();

      const info = await client.info('server');
      const version = info.match(/redis_version:(.+)/)?.[1]?.trim();
      const memory = info.match(/used_memory_human:(.+)/)?.[1]?.trim();

      return {
        status: 'ok',
        responseTimeMs: Date.now() - start,
        version,
        usedMemory: memory,
      };
    } catch {
      return { status: 'error', responseTimeMs: Date.now() - start };
    }
  }

  // ─── Private: Metrics Queries — كل query محاطة بـ try/catch ──────────────

  private async getUserStats() {
    try {
      const [result] = await this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')                       AS active,
          COUNT(*) FILTER (WHERE status = 'inactive')                     AS suspended,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_this_week,
          COUNT(*)                                                         AS total
        FROM users
      `);
      return {
        total:       +result.total       || 0,
        active:      +result.active      || 0,
        suspended:   +result.suspended   || 0,
        newThisWeek: +result.new_this_week || 0,
      };
    } catch {
      return { total: 0, active: 0, suspended: 0, newThisWeek: 0 };
    }
  }

  private async getStoreStats() {
    try {
      const [result] = await this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')    AS active,
          COUNT(*) FILTER (WHERE status = 'suspended') AS suspended,
          COUNT(*)                                      AS total
        FROM stores
      `);
      return {
        total:     +result.total     || 0,
        active:    +result.active    || 0,
        suspended: +result.suspended || 0,
      };
    } catch {
      return { total: 0, active: 0, suspended: 0 };
    }
  }

  private async getMessageStats() {
    try {
      const [result] = await this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'sent')                           AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')                         AS failed,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h
        FROM message_logs
      `);
      return {
        totalSent:   +result.sent    || 0,
        totalFailed: +result.failed  || 0,
        last24h:     +result.last_24h || 0,
      };
    } catch {
      // message_logs قد لا تكون موجودة بعد
      return { totalSent: 0, totalFailed: 0, last24h: 0 };
    }
  }

  private async getSubscriptionStats() {
    try {
      const [result] = await this.dataSource.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')                                     AS active,
          COUNT(*) FILTER (WHERE status = 'trialing')                                   AS trial,
          COUNT(*) FILTER (WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '7 days') AS expiring_soon
        FROM subscriptions
      `);
      return {
        active:        +result.active       || 0,
        trial:         +result.trial        || 0,
        expiringSoon:  +result.expiring_soon || 0,
      };
    } catch {
      return { active: 0, trial: 0, expiringSoon: 0 };
    }
  }
}
