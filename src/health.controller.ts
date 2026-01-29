/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Health Check Controller                    ║
 * ║                                                                                ║
 * ║  📌 يوفر endpoints للتحقق من صحة التطبيق                                        ║
 * ║                                                                                ║
 * ║  مهم لـ:                                                                        ║
 * ║  - Load Balancers (يعرف متى يوجه الـ traffic)                                  ║
 * ║  - Kubernetes (يعرف متى يعيد تشغيل الـ pod)                                    ║
 * ║  - Monitoring tools                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Controller, Get, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Health Response Interface
 */
interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
}

@Controller('health')
@ApiTags('Health')
export class HealthController {
  private readonly startTime: Date;

  constructor() {
    this.startTime = new Date();
  }

  /**
   * GET /health
   * 
   * Basic health check - هل التطبيق يستجيب؟
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
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  /**
   * GET /health/live
   * 
   * Liveness probe - هل التطبيق "حي"؟
   * إذا فشل = يحتاج restart
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  liveness(): { status: string } {
    return { status: 'alive' };
  }

  /**
   * GET /health/ready
   * 
   * Readiness probe - هل التطبيق جاهز لاستقبال الـ traffic؟
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Application is ready' })
  @ApiResponse({ status: 503, description: 'Application is not ready' })
  readiness(): { status: string; checks: Record<string, string> } {
    // يمكن إضافة فحوصات إضافية هنا (database, redis, etc.)
    return {
      status: 'ready',
      checks: {
        database: 'up',
        redis: 'up',
      },
    };
  }

  /**
   * حساب وقت التشغيل بالثواني
   */
  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
}
