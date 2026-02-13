/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Controller                             ║
 * ║                                                                                ║
 * ║  📌 نقاط الوصول لإدارة الحملات التسويقية                                        ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  POST   /campaigns              → إنشاء حملة جديدة                             ║
 * ║  GET    /campaigns              → قائمة الحملات                                ║
 * ║  GET    /campaigns/:id          → تفاصيل حملة                                  ║
 * ║  PATCH  /campaigns/:id          → تحديث حملة                                   ║
 * ║  POST   /campaigns/:id/execute  → تنفيذ حملة فوراً                             ║
 * ║  POST   /campaigns/:id/pause    → إيقاف حملة                                   ║
 * ║  POST   /campaigns/:id/resume   → استئناف حملة                                 ║
 * ║  POST   /campaigns/:id/cancel   → إلغاء حملة                                   ║
 * ║  GET    /campaigns/:id/stats    → إحصائيات حملة                                ║
 * ║  POST   /campaigns/preview      → معاينة عدد المستهدفين                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

import {
  CampaignsService,
  CreateCampaignDto,
} from './campaigns.service';
import { CampaignType, CampaignStatus } from '@database/entities/campaign.entity';

@ApiTags('Campaigns')
@ApiBearerAuth('JWT-auth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'campaigns',
  version: '1',
})
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns - إنشاء حملة جديدة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post()
  @ApiOperation({
    summary: 'إنشاء حملة جديدة',
    description: 'إنشاء حملة تسويقية (مجدولة، مشروطة، أو متكررة)',
  })
  @ApiResponse({ status: 201, description: 'تم إنشاء الحملة' })
  async create(@CurrentUser() user: any,
    @Body() dto: CreateCampaignDto) {
    // مؤقتاً: tenant ID ثابت
    const tenantId = user.tenantId;
    return this.campaignsService.create({ ...dto, tenantId });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /campaigns - قائمة الحملات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'قائمة الحملات',
    description: 'جلب جميع حملات المستأجر مع فلترة وتصفح',
  })
  @ApiQuery({ name: 'status', required: false, enum: CampaignStatus })
  @ApiQuery({ name: 'type', required: false, enum: CampaignType })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @CurrentUser() user: any,
    @Query('status') status?: CampaignStatus,
    @Query('type') type?: CampaignType,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const tenantId = user.tenantId;
    return this.campaignsService.findAll(tenantId, {
      status,
      type,
      page,
      limit,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /campaigns/:id - تفاصيل حملة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @ApiOperation({
    summary: 'تفاصيل حملة',
    description: 'جلب تفاصيل حملة معينة',
  })
  async findOne(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    return this.campaignsService.findById(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/:id/execute - تنفيذ فوري
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تنفيذ الحملة فوراً',
    description: 'بدء إرسال رسائل الحملة فوراً (للحملات المجدولة)',
  })
  async execute(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    await this.campaignsService.executeNow(id, tenantId);
    return { message: 'تم بدء تنفيذ الحملة' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/:id/pause - إيقاف مؤقت
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إيقاف الحملة مؤقتاً',
    description: 'إيقاف حملة نشطة مؤقتاً',
  })
  async pause(@CurrentUser() user: any,
    @Param('id') id: string) {
    // 🔧 FIX C-04: Pass tenantId to prevent IDOR
    return this.campaignsService.pause(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/:id/resume - استئناف
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'استئناف الحملة',
    description: 'استئناف حملة متوقفة مؤقتاً',
  })
  async resume(@CurrentUser() user: any,
    @Param('id') id: string) {
    // 🔧 FIX C-04: Pass tenantId to prevent IDOR
    return this.campaignsService.resume(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/:id/cancel - إلغاء
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'إلغاء الحملة',
    description: 'إلغاء حملة نهائياً',
  })
  async cancel(@CurrentUser() user: any,
    @Param('id') id: string) {
    // 🔧 FIX C-04: Pass tenantId to prevent IDOR
    return this.campaignsService.cancel(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /campaigns/:id/stats - إحصائيات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/stats')
  @ApiOperation({
    summary: 'إحصائيات الحملة',
    description: 'جلب إحصائيات الإرسال والتوصيل والقراءة',
  })
  async getStats(@CurrentUser() user: any,
    @Param('id') id: string) {
    const tenantId = user.tenantId;
    return this.campaignsService.getStats(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/preview - معاينة الاستهداف
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'معاينة عدد المستهدفين',
    description: 'معرفة عدد العملاء الذين سيستهدفهم segment معين',
  })
  async preview(@CurrentUser() user: any,
    @Body() body: { segment: Record<string, unknown> }) {
    const tenantId = user.tenantId;
    const count = await this.campaignsService.previewSegment(
      tenantId,
      body.segment,
    );
    return { targetedCount: count };
  }
}
