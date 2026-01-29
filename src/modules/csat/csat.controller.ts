/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - CSAT Controller                                  ║
 * ║                                                                                ║
 * ║  📌 إدارة تقييم رضا العملاء                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CsatService } from './csat.service';
import { UpdateCsatSettingsDto, SubmitCsatDto } from './dto';

@ApiTags('CSAT - تقييم رضا العملاء')
@Controller({
  path: 'csat',
  version: '1',
})
export class CsatController {
  constructor(private readonly csatService: CsatService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إعدادات التقييم',
    description: 'جلب إعدادات نظام تقييم رضا العملاء',
  })
  async getSettings() {
    const tenantId = 'test-tenant-id';
    return this.csatService.getSettings(tenantId);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تحديث الإعدادات',
    description: 'تحديث إعدادات نظام التقييم',
  })
  async updateSettings(@Body() dto: UpdateCsatSettingsDto) {
    const tenantId = 'test-tenant-id';
    return this.csatService.updateSettings(tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Survey Types
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('types')
  @ApiOperation({
    summary: 'أنواع التقييم',
    description: 'أنواع استطلاعات رضا العملاء المدعومة',
  })
  getSurveyTypes() {
    return {
      types: [
        {
          id: 'csat',
          name: 'تقييم الرضا',
          nameEn: 'Customer Satisfaction Score',
          description: 'مقياس 1-5 لقياس رضا العميل',
          scale: [1, 2, 3, 4, 5],
          emoji: ['😠', '😞', '😐', '😊', '😍'],
          question: 'كيف تقيم تجربتك معنا؟',
        },
        {
          id: 'nps',
          name: 'صافي نقاط الترويج',
          nameEn: 'Net Promoter Score',
          description: 'مقياس 0-10 لقياس احتمالية التوصية',
          scale: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          question: 'ما مدى احتمالية أن توصي بنا لصديق أو زميل؟',
          categories: {
            detractors: [0, 6],
            passives: [7, 8],
            promoters: [9, 10],
          },
        },
        {
          id: 'ces',
          name: 'جهد العميل',
          nameEn: 'Customer Effort Score',
          description: 'مقياس 1-7 لقياس سهولة التعامل',
          scale: [1, 2, 3, 4, 5, 6, 7],
          question: 'ما مدى سهولة حل مشكلتك؟',
        },
        {
          id: 'thumbs',
          name: 'إعجاب/عدم إعجاب',
          nameEn: 'Thumbs Up/Down',
          description: 'تقييم بسيط بإبهام لأعلى أو أسفل',
          options: ['up', 'down'],
          emoji: ['👍', '👎'],
          question: 'هل كانت هذه المحادثة مفيدة؟',
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Surveys
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('surveys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'قائمة التقييمات',
    description: 'جلب جميع تقييمات العملاء',
  })
  @ApiQuery({ name: 'type', required: false, enum: ['csat', 'nps', 'ces', 'thumbs'] })
  @ApiQuery({ name: 'rating', required: false, description: 'فلترة حسب التقييم' })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getSurveys(
    @Query('type') type?: string,
    @Query('rating') rating?: number,
    @Query('agentId') agentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const tenantId = 'test-tenant-id';
    return this.csatService.getSurveys(tenantId, {
      type,
      rating,
      agentId,
      from,
      to,
      page,
      limit,
    });
  }

  @Get('surveys/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تفاصيل تقييم',
    description: 'جلب تفاصيل تقييم معين',
  })
  async getSurvey(@Param('id', ParseUUIDPipe) id: string) {
    const tenantId = 'test-tenant-id';
    return this.csatService.getSurveyById(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Submit Survey (Public)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('surveys/:token/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إرسال تقييم',
    description: 'إرسال تقييم من العميل (بدون تسجيل دخول)',
  })
  async submitSurvey(
    @Param('token') token: string,
    @Body() dto: SubmitCsatDto,
  ) {
    return this.csatService.submitSurvey(token, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Analytics
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('analytics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تحليلات التقييم',
    description: 'إحصائيات وتحليلات تقييمات العملاء',
  })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'week', 'month', 'quarter', 'year'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getAnalytics(
    @Query('period') period = 'month',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = 'test-tenant-id';
    return this.csatService.getAnalytics(tenantId, { period, from, to });
  }

  @Get('analytics/agents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تقييمات الوكلاء',
    description: 'تقييمات كل وكيل من فريق الدعم',
  })
  async getAgentRatings(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = 'test-tenant-id';
    return this.csatService.getAgentRatings(tenantId, { from, to });
  }

  @Get('analytics/trends')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'اتجاهات التقييم',
    description: 'تطور التقييمات عبر الزمن',
  })
  async getTrends(
    @Query('period') period = 'month',
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const tenantId = 'test-tenant-id';
    return this.csatService.getTrends(tenantId, { period, groupBy });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تصدير التقييمات',
    description: 'تصدير التقييمات إلى ملف CSV/Excel',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async exportSurveys(
    @Query('format') format = 'csv',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = 'test-tenant-id';
    return this.csatService.exportSurveys(tenantId, { format, from, to });
  }
}
