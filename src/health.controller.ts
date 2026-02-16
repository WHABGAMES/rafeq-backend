/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Health Check Controller                    ║
 * ║                                                                                ║
 * ║  🔧 FIX M-04: Readiness probe now checks DB + Redis (not just ready: true)    ║
 * ║                                                                                ║
 * ║  Endpoints:                                                                   ║
 * ║  • GET /health       → Basic app health                                       ║
 * ║  • GET /health/live  → Liveness probe (is process alive?)                     ║
 * ║  • GET /health/ready → Readiness probe (can we serve traffic?)                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  HttpStatus,
  HttpCode,
  Res,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
}

interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  ready: boolean;
  checks: {
    database: { status: string; latencyMs?: number };
    redis: { status: string; latencyMs?: number };
  };
}

@Controller('health')
@ApiTags('Health')
export class HealthController {
  private readonly startTime: Date;
  private readonly logger = new Logger(HealthController.name);
  private redisClient: Redis | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.startTime = new Date();

    // Create a lightweight Redis client for health checks only
    try {
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = this.configService.get<number>('REDIS_PORT', 6379);
      const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;

      this.redisClient = new Redis({
        host,
        port,
        password,
        db: 0,
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        lazyConnect: true, // Don't connect until first use
      });

      // Suppress error events (we handle failures in readiness check)
      this.redisClient.on('error', () => {});
    } catch {
      this.logger.warn('Could not create Redis client for health checks');
    }
  }

  /**
   * GET /health — Basic health check
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Basic health check' })
  @ApiResponse({ status: 200, description: 'Application is healthy' })
  healthCheck(): HealthResponse {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
    };
  }

  /**
   * GET /health/live — Liveness probe
   * If this fails → container needs restart
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  liveness(): { status: string } {
    return { status: 'alive' };
  }

  /**
   * GET /health/ready — Readiness probe
   * 🔧 FIX M-04: Actually checks DB and Redis connectivity
   * Returns 503 if any dependency is unhealthy
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB + Redis' })
  @ApiResponse({ status: 200, description: 'Application is ready to serve traffic' })
  @ApiResponse({ status: 503, description: 'Dependencies not ready' })
  async readiness(@Res() res: Response): Promise<void> {
    const result: ReadinessResponse = {
      status: 'ready',
      ready: true,
      checks: {
        database: { status: 'unknown' },
        redis: { status: 'unknown' },
      },
    };

    // ── Check PostgreSQL ──
    try {
      const dbStart = Date.now();
      await this.dataSource.query('SELECT 1');
      result.checks.database = {
        status: 'ok',
        latencyMs: Date.now() - dbStart,
      };
    } catch (error) {
      result.checks.database = { status: 'down' };
      result.ready = false;
      result.status = 'not_ready';
      this.logger.error('Health check: Database is down', error instanceof Error ? error.message : '');
    }

    // ── Check Redis ──
    try {
      if (this.redisClient) {
        const redisStart = Date.now();
        await this.redisClient.ping();
        result.checks.redis = {
          status: 'ok',
          latencyMs: Date.now() - redisStart,
        };
      } else {
        result.checks.redis = { status: 'not_configured' };
      }
    } catch (error) {
      result.checks.redis = { status: 'down' };
      result.ready = false;
      result.status = 'not_ready';
      this.logger.error('Health check: Redis is down', error instanceof Error ? error.message : '');
    }

    const statusCode = result.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(statusCode).json(result);
  }

  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
}
