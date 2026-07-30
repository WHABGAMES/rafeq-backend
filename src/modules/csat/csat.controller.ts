/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - CSAT Controller (Fixed)                          ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /csat/settings            → إعدادات التقييم                           ║
 * ║  PUT    /csat/settings            → تحديث الإعدادات                           ║
 * ║  GET    /csat/types               → أنواع التقييم                             ║
 * ║  GET    /csat/surveys             → قائمة التقييمات {responses, avgRating}    ║
 * ║  GET    /csat/surveys/:id         → تفاصيل تقييم                              ║
 * ║  POST   /csat/surveys/:token/submit → إرسال تقييم (بدون JWT)                  ║
 * ║  GET    /csat/overview            → ✅ إحصائيات سريعة للـ frontend            ║
 * ║  GET    /csat/analytics           → تحليلات مفصّلة                            ║
 * ║  GET    /csat/analytics/agents    → تقييمات الوكلاء                           ║
 * ║  GET    /csat/analytics/trends    → اتجاهات التقييم                           ║
 * ║  GET    /csat/export              → تصدير التقييمات                           ║
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
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsatService } from './csat.service';
import { UpdateCsatSettingsDto, SubmitCsatDto } from './dto';

@ApiTags('CSAT - تقييم رضا العملاء')
@Controller({
  path: 'csat',
  version: '1',
})
export class CsatController {
  constructor(private readonly csatService: CsatService) {}

  // ═══════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'إعدادات التقييم' })
  async getSettings(@CurrentUser() user: any) {
    return this.csatService.getSettings(user.tenantId);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تحديث الإعدادات' })
  async updateSettings(
    @CurrentUser() user: any,
    @Body() dto: UpdateCsatSettingsDto,
  ) {
    return this.csatService.updateSettings(user.tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════
  // Survey Types (Public — no auth needed)
  // ═══════════════════════════════════════════════════════════

  @Get('types')
  @ApiOperation({ summary: 'أنواع التقييم المدعومة' })
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
          categories: { detractors: [0, 6], passives: [7, 8], promoters: [9, 10] },
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

  // ═══════════════════════════════════════════════════════════
  // Surveys — List
  // ═══════════════════════════════════════════════════════════

  @Get('surveys')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'قائمة التقييمات — يُرجع { responses, avgRating, pagination }' })
  @ApiQuery({ name: 'type',    required: false, enum: ['csat', 'nps', 'ces', 'thumbs'] })
  @ApiQuery({ name: 'rating',  required: false })
  @ApiQuery({ name: 'agentId', required: false })
  @ApiQuery({ name: 'from',    required: false })
  @ApiQuery({ name: 'to',      required: false })
  @ApiQuery({ name: 'page',    required: false })
  @ApiQuery({ name: 'limit',   required: false })
  async getSurveys(
    @CurrentUser() user: any,
    @Query('type')    type?: string,
    @Query('rating')  ratingRaw?: string,
    @Query('agentId') agentId?: string,
    @Query('from')    from?: string,
    @Query('to')      to?: string,
    @Query('page', new ParseIntPipe({ optional: true }))    page = 1,
    @Query('limit', new ParseIntPipe({ optional: true }))   limit = 20,
  ) {
    // ✅ FIX NaN: Query params تصل دائماً كـ string من HTTP
    // Number("") = NaN, Number("null") = NaN → يكسر PostgreSQL smallint
    // نحوّل فقط إذا كانت قيمة رقمية صالحة فعلاً
    const parsedRating = (ratingRaw !== undefined && ratingRaw !== '' && ratingRaw !== 'null')
      ? Number(ratingRaw)
      : undefined;
    const rating = (parsedRating !== undefined && !isNaN(parsedRating)) ? parsedRating : undefined;

    return this.csatService.getSurveys(user.tenantId, {
      type, rating, agentId, from, to, page, limit,
    });
  }

  @Get('surveys/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تفاصيل تقييم' })
  async getSurvey(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.csatService.getSurveyById(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════
  // Submit Survey — PUBLIC (no JWT, uses token)
  // ═══════════════════════════════════════════════════════════

  @Post('surveys/:token/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إرسال تقييم من العميل',
    description: 'Endpoint عام — لا يحتاج JWT — العميل يُرسل تقييمه عبر رابط التوكن',
  })
  async submitSurvey(
    @Param('token') token: string,
    @Body() dto: SubmitCsatDto,
  ) {
    return this.csatService.submitSurvey(token, dto);
  }

  // ═══════════════════════════════════════════════════════════
  // Overview — ✅ يُغذّي الـ frontend /csat/overview
  // ═══════════════════════════════════════════════════════════

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'نظرة عامة على رضا العملاء',
    description: 'يُرجع: totalSurveys, avgRating, satisfactionRate, improvementRate',
  })
  async getOverview(@CurrentUser() user: any) {
    return this.csatService.getOverview(user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════
  // Analytics
  // ═══════════════════════════════════════════════════════════

  @Get('analytics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تحليلات التقييم المفصّلة' })
  @ApiQuery({ name: 'period', required: false, enum: ['day', 'week', 'month', 'quarter', 'year'] })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  async getAnalytics(
    @CurrentUser() user: any,
    @Query('period') period = 'month',
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.csatService.getAnalytics(user.tenantId, { period, from, to });
  }

  @Get('analytics/agents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تقييمات الوكلاء' })
  async getAgentRatings(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return this.csatService.getAgentRatings(user.tenantId, { from, to });
  }

  @Get('analytics/trends')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'اتجاهات التقييم عبر الزمن' })
  async getTrends(
    @CurrentUser() user: any,
    @Query('period')  period = 'month',
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    return this.csatService.getTrends(user.tenantId, { period, groupBy });
  }

  // ═══════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════

  @Get('export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تصدير التقييمات' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'xlsx'] })
  @ApiQuery({ name: 'from',   required: false })
  @ApiQuery({ name: 'to',     required: false })
  async exportSurveys(
    @CurrentUser() user: any,
    @Query('format') format = 'csv',
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.csatService.exportSurveys(user.tenantId, { format, from, to });
  }
}
