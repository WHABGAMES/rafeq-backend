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
  Req,
  Query,
  Headers,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsService } from './settings.service';

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
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getAllSettings(tenantId, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // الإعدادات العامة
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('general')
  async getGeneralSettings(
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getGeneralSettings(tenantId, storeId);
  }

  @Put('general')
  async updateGeneralSettings(
    @Req() req: any,
    @Body() data: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateGeneralSettings(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إعدادات الإشعارات
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('notifications')
  async getNotificationSettings(
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getNotificationSettings(tenantId, storeId);
  }

  @Put('notifications')
  async updateNotificationSettings(
    @Req() req: any,
    @Body() data: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateNotificationSettings(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ساعات العمل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('working-hours')
  async getWorkingHours(
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getWorkingHours(tenantId, storeId);
  }

  @Put('working-hours')
  async updateWorkingHours(
    @Req() req: any,
    @Body() data: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateWorkingHours(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // الردود التلقائية
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('auto-replies')
  async getAutoReplies(
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getAutoReplies(tenantId, storeId);
  }

  @Put('auto-replies')
  async updateAutoReplies(
    @Req() req: any,
    @Body() data: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateAutoReplies(tenantId, data, storeId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // إعدادات الفريق
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('team')
  async getTeamSettings(
    @Req() req: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.getTeamSettings(tenantId, storeId);
  }

  @Put('team')
  async updateTeamSettings(
    @Req() req: any,
    @Body() data: any,
    @Headers('x-store-id') storeIdHeader?: string,
    @Query('storeId') storeIdQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const storeId = this.getStoreId(storeIdHeader, storeIdQuery);
    return this.settingsService.updateTeamSettings(tenantId, data, storeId);
  }
}
