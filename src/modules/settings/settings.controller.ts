/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Settings Controller                              ║
 * ║                                                                                ║
 * ║  ✅ v2: يمرر storeId من header أو query parameter للـ service                ║
 * ║  ✅ كل متجر له إعداداته المنفصلة                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Query,
  Headers,
} from '@nestjs/common';
import { User } from '@database/entities';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsService } from './settings.service';
import {
  UpdateAutoRepliesDto,
  UpdateGeneralSettingsDto,
  UpdateNotificationSettingsDto,
  UpdateTeamSettingsDto,
  UpdateWorkingHoursDto,
} from './dto';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * استخراج storeId من:
   * 1. Header: x-store-id (الأولوية)
   * 2. Query parameter: storeId
   */
  private getStoreId(
    storeIdHeader?: string,
    storeIdQuery?: string,
  ): string | undefined {
    return storeIdHeader || storeIdQuery || undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // جميع الإعدادات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  async getAllSettings(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getAllSettings(tenantId, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // الإعدادات العامة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('general')
  async getGeneralSettings(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getGeneralSettings(tenantId, storeId);
  }

  @Put('general')
  async updateGeneralSettings(
    @CurrentUser() user: User,
    @Body() data: UpdateGeneralSettingsDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateGeneralSettings(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إعدادات الإشعارات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('notifications')
  async getNotificationSettings(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getNotificationSettings(tenantId, storeId);
  }

  @Put('notifications')
  async updateNotificationSettings(
    @CurrentUser() user: User,
    @Body() data: UpdateNotificationSettingsDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateNotificationSettings(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ساعات العمل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('working-hours')
  async getWorkingHours(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getWorkingHours(tenantId, storeId);
  }

  @Put('working-hours')
  async updateWorkingHours(
    @CurrentUser() user: User,
    @Body() data: UpdateWorkingHoursDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateWorkingHours(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // الردود التلقائية
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('auto-replies')
  async getAutoReplies(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getAutoReplies(tenantId, storeId);
  }

  @Put('auto-replies')
  async updateAutoReplies(
    @CurrentUser() user: User,
    @Body() data: UpdateAutoRepliesDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateAutoReplies(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إعدادات الفريق
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('team')
  async getTeamSettings(
    @CurrentUser() user: User,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getTeamSettings(tenantId, storeId);
  }

  @Put('team')
  async updateTeamSettings(
    @CurrentUser() user: User,
    @Body() data: UpdateTeamSettingsDto,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateTeamSettings(tenantId, data, storeId);
  }
}
