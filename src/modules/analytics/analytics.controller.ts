/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Analytics Controller                             ║
 * ║                                                                                ║
 * ║  📌 نقاط الوصول للتحليلات والتقارير                                             ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET /analytics/overview           → نظرة عامة                                 ║
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
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { AnalyticsService, DateRange } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth('JWT-auth')
@Controller({
  path: 'analytics',
  version: '1',
})
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/overview - نظرة عامة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('overview')
  @ApiOperation({
    summary: 'نظرة عامة',
    description: 'إحصائيات سريعة: المحادثات، الرسائل، العملاء، وقت الرد',
  })
  async getOverview() {
    const tenantId = 'test-tenant-id';
    return this.analyticsService.getOverview(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/conversations - إحصائيات المحادثات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('conversations')
  @ApiOperation({
    summary: 'إحصائيات المحادثات',
    description: 'المحادثات حسب اليوم، القناة، الحالة، وأوقات الذروة',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getConversationStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = 'test-tenant-id';
    const range = this.getDateRange(startDate, endDate);
    return this.analyticsService.getConversationStats(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/team - أداء الفريق
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('team')
  @ApiOperation({
    summary: 'أداء الفريق',
    description: 'إحصائيات كل موظف: المحادثات، وقت الرد، التقييم',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getTeamPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = 'test-tenant-id';
    const range = this.getDateRange(startDate, endDate);
    return this.analyticsService.getTeamPerformance(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/campaigns - إحصائيات الحملات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('campaigns')
  @ApiOperation({
    summary: 'إحصائيات الحملات',
    description: 'الإرسال، التوصيل، القراءة، ونسب النجاح',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getCampaignStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const tenantId = 'test-tenant-id';
    const range = this.getDateRange(startDate, endDate);
    return this.analyticsService.getCampaignStats(tenantId, range);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/trends/:metric - الاتجاهات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('trends/:metric')
  @ApiOperation({
    summary: 'الاتجاهات',
    description: 'رسم بياني للمحادثات/الرسائل/العملاء عبر الزمن',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async getTrends(
    @Param('metric') metric: 'conversations' | 'messages' | 'customers',
    @Query('days') days = 30,
  ) {
    const tenantId = 'test-tenant-id';
    return this.analyticsService.getTrends(tenantId, metric, days);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /analytics/export - تصدير تقرير
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
    @Query('type') type: string,
    @Query('format') format: 'csv' | 'json' = 'json',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Res() res?: Response,
  ) {
    const tenantId = 'test-tenant-id';
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
  // 🔧 Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تحويل التواريخ النصية لـ DateRange
   */
  private getDateRange(startDate?: string, endDate?: string): DateRange {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // آخر 30 يوم

    return { startDate: start, endDate: end };
  }
}
