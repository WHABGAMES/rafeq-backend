/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Analytics Controller                             ║
 * ║                                                                                ║
 * ║  📌 نقاط الوصول للتحليلات والتقارير                                             ║
 * ║                                                                                ║
 * ║  ✅ FIX: getOverview يقبل startDate/endDate لدعم فلتر التاريخ                   ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET /analytics/overview           → نظرة عامة (+ فلتر تاريخ)                  ║
 * ║  GET /analytics/conversations      → إحصائيات المحادثات                        ║
 * ║  GET /analytics/team               → أداء الفريق                               ║
 * ║  GET /analytics/campaigns          → إحصائيات الحملات                          ║
 * ║  GET /analytics/trends/:metric     → الاتجاهات                                 ║
 * ║  GET /analytics/export             → تصدير تقرير                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { AnalyticsService, DateRange } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'analytics',
  version: '1',
})
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/overview
  // ✅ FIX: يقبل الآن startDate/endDate لدعم فلتر (يوم/أسبوع/شهر/سنة)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('overview')
  @ApiOperation({
    summary: 'نظرة عامة',
    description: 'إحصائيات سريعة: المحادثات، الرسائل، العملاء، وقت الرد',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getOverview(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = user.tenantId;

    // ✅ إذا الفرونت أرسل تواريخ → نمررها للسيرفس
    // إذا ما أرسل → السيرفس يستخدم "اليوم" كفترة افتراضية
    const range = (startDate || endDate)
      ? this.getDateRange(startDate, endDate)
      : undefined;

    return this.analyticsService.getOverview(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/conversations
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('conversations')
  @ApiOperation({
    summary: 'إحصائيات المحادثات',
    description: 'المحادثات حسب اليوم، القناة، الحالة، وأوقات الذروة',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getConversationStats(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = user.tenantId;
    const range = this.getDateRange(startDate, endDate);
    return this.analyticsService.getConversationStats(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/team
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('team')
  @ApiOperation({
    summary: 'أداء الفريق',
    description: 'إحصائيات كل موظف: المحادثات، وقت الرد، نسبة الحل',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getTeamPerformance(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = user.tenantId;
    const range = this.getDateRange(startDate, endDate);
    return this.analyticsService.getTeamPerformance(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/campaigns
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('campaigns')
  @ApiOperation({
    summary: 'إحصائيات الحملات',
    description: 'الإرسال، التوصيل، القراءة، ونسب النجاح',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getCampaignStats(
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = user.tenantId;
    const range = this.getDateRange(startDate, endDate);
    return this.analyticsService.getCampaignStats(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/trends/:metric
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('trends/:metric')
  @ApiOperation({
    summary: 'الاتجاهات',
    description: 'رسم بياني للمحادثات/الرسائل/العملاء عبر الزمن',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getTrends(
    @CurrentUser() user: any,
    @Param('metric') metric: 'conversations' | 'messages' | 'customers',
    @Query('days', new ParseIntPipe({ optional: true })) days = 30,
  ) {
    const tenantId = user.tenantId;
    return this.analyticsService.getTrends(tenantId, metric, days);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/export
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('export')
  @ApiOperation({
    summary: 'تصدير تقرير',
    description: 'تصدير التقرير كـ CSV أو JSON',
  })
  @ApiQuery({
    name: 'type',
    required: true,
    enum: ['overview', 'conversations', 'team', 'campaigns'],
  })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'json'] })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async exportReport(
    @CurrentUser() user: any,
    @Query('type') type: string,
    @Query('format') format: 'csv' | 'json' = 'json',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Res() res?: Response,
  ) {
    const tenantId = user.tenantId;
    const range = this.getDateRange(startDate, endDate);

    const result = await this.analyticsService.exportReport(
      tenantId,
      type,
      range,
      format,
    );

    if (res) {
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      res.send(result.data);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 Helper
  // ═══════════════════════════════════════════════════════════════════════════════

  private getDateRange(startDate?: string, endDate?: string): DateRange {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    return { startDate: start, endDate: end };
  }
}
