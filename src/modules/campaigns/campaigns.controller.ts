/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Controller v2                          ║
 * ║                                                                                ║
 * ║  ✅ FIX: storeId يُستخرج من x-store-id header                               ║
 * ║  ✅ FIX: preview يستقبل audienceFilter + channel + storeId                   ║
 * ║  ✅ FIX: createdBy يُحفظ من user.id                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
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
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CampaignsService, CreateCampaignDto } from './campaigns.service';
import { CampaignType, CampaignStatus, CampaignChannel, AudienceFilter } from '@database/entities/campaign.entity';

@ApiTags('Campaigns')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'campaigns', version: '1' })
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post()
  @ApiOperation({ summary: 'إنشاء حملة جديدة' })
  async create(
    @CurrentUser() user: any,
    @Req() req: Request,
    @Body() dto: CreateCampaignDto,
  ) {
    const tenantId = user.tenantId;
    // ✅ FIX: storeId من header أو body
    const storeId = dto.storeId || (req.headers['x-store-id'] as string) || undefined;

    return this.campaignsService.create({
      ...dto,
      tenantId,
      storeId,
      createdBy: user.id,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /campaigns
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'قائمة الحملات' })
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
    return this.campaignsService.findAll(user.tenantId, { status, type, page, limit });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/preview — يجب أن يكون قبل :id routes
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'معاينة عدد المستهدفين' })
  async preview(
    @CurrentUser() user: any,
    @Req() req: Request,
    @Body() body: {
      audienceFilter: AudienceFilter;
      channel?: CampaignChannel;
      storeId?: string;
    },
  ) {
    const tenantId = user.tenantId;
    const storeId = body.storeId || (req.headers['x-store-id'] as string) || null;
    const channel = body.channel || CampaignChannel.WHATSAPP;

    const count = await this.campaignsService.previewSegment(
      tenantId,
      storeId,
      body.audienceFilter,
      channel,
    );

    return { targetedCount: count };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /campaigns/:id
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل حملة' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.campaignsService.findById(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PATCH /campaigns/:id
  // ═══════════════════════════════════════════════════════════════════════════════

  @Patch(':id')
  @ApiOperation({ summary: 'تحديث حملة' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Req() req: Request,
    @Body() dto: Partial<CreateCampaignDto>,
  ) {
    if (!dto.storeId && req.headers['x-store-id']) {
      dto.storeId = req.headers['x-store-id'] as string;
    }
    return this.campaignsService.update(id, user.tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DELETE /campaigns/:id
  // ═══════════════════════════════════════════════════════════════════════════════

  @Delete(':id')
  @ApiOperation({ summary: 'حذف حملة' })
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.campaignsService.remove(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/:id/execute
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تنفيذ الحملة فوراً' })
  async execute(@CurrentUser() user: any, @Param('id') id: string) {
    await this.campaignsService.executeNow(id, user.tenantId);
    return { message: 'تم بدء تنفيذ الحملة' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /campaigns/:id/pause|resume|cancel
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إيقاف الحملة مؤقتاً' })
  async pause(@CurrentUser() user: any, @Param('id') id: string) {
    return this.campaignsService.pause(id, user.tenantId);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'استئناف الحملة' })
  async resume(@CurrentUser() user: any, @Param('id') id: string) {
    return this.campaignsService.resume(id, user.tenantId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إلغاء الحملة' })
  async cancel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.campaignsService.cancel(id, user.tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /campaigns/:id/stats
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get(':id/stats')
  @ApiOperation({ summary: 'إحصائيات الحملة' })
  async getStats(@CurrentUser() user: any, @Param('id') id: string) {
    return this.campaignsService.getStats(id, user.tenantId);
  }
}
