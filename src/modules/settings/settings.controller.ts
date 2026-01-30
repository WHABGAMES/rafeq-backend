/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Settings Controller                              ║
 * ║                                                                                ║
 * ║  📌 إدارة الإعدادات العامة للحساب                                               ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /settings/general          → الإعدادات العامة                          ║
 * ║  PUT    /settings/general          → تحديث الإعدادات العامة                    ║
 * ║  GET    /settings/notifications    → إعدادات الإشعارات                        ║
 * ║  PUT    /settings/notifications    → تحديث إعدادات الإشعارات                  ║
 * ║  GET    /settings/working-hours    → ساعات العمل                              ║
 * ║  PUT    /settings/working-hours    → تحديث ساعات العمل                        ║
 * ║  GET    /settings/auto-replies     → الردود التلقائية                         ║
 * ║  PUT    /settings/auto-replies     → تحديث الردود التلقائية                   ║
 * ║  GET    /settings/team             → إعدادات الفريق                           ║
 * ║  PUT    /settings/team             → تحديث إعدادات الفريق                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettingsService } from './settings.service';

@ApiTags('Settings - الإعدادات')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'settings',
  version: '1',
})
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // General Settings
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('general')
  @ApiOperation({
    summary: 'الإعدادات العامة',
    description: 'جلب الإعدادات العامة للحساب',
  })
  async getGeneralSettings(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.settingsService.getGeneralSettings(tenantId);
  }

  @Put('general')
  @ApiOperation({
    summary: 'تحديث الإعدادات العامة',
    description: 'تحديث الإعدادات العامة للحساب',
  })
  async updateGeneralSettings(
    @CurrentUser() user: any,
    @Body() body: {
      storeName?: string;
      storeUrl?: string;
      timezone?: string;
      language?: string;
      currency?: string;
      logo?: string;
    },
  ) {
    const tenantId = user.tenantId;
    return this.settingsService.updateGeneralSettings(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Notifications Settings
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('notifications')
  @ApiOperation({
    summary: 'إعدادات الإشعارات',
    description: 'جلب إعدادات الإشعارات',
  })
  async getNotificationSettings(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.settingsService.getNotificationSettings(tenantId);
  }

  @Put('notifications')
  @ApiOperation({
    summary: 'تحديث إعدادات الإشعارات',
    description: 'تحديث إعدادات الإشعارات',
  })
  async updateNotificationSettings(
    @CurrentUser() user: any,
    @Body() body: {
      email?: {
        newConversation?: boolean;
        newMessage?: boolean;
        dailyReport?: boolean;
        weeklyReport?: boolean;
      };
      push?: {
        newConversation?: boolean;
        newMessage?: boolean;
        mentions?: boolean;
      };
      sound?: {
        enabled?: boolean;
        volume?: number;
      };
    },
  ) {
    const tenantId = user.tenantId;
    return this.settingsService.updateNotificationSettings(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Working Hours
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('working-hours')
  @ApiOperation({
    summary: 'ساعات العمل',
    description: 'جلب ساعات العمل',
  })
  async getWorkingHours(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.settingsService.getWorkingHours(tenantId);
  }

  @Put('working-hours')
  @ApiOperation({
    summary: 'تحديث ساعات العمل',
    description: 'تحديث ساعات العمل',
  })
  async updateWorkingHours(
    @CurrentUser() user: any,
    @Body() body: {
      enabled?: boolean;
      timezone?: string;
      schedule?: Array<{
        day: string;
        enabled: boolean;
        start: string;
        end: string;
      }>;
      holidays?: Array<{
        date: string;
        name: string;
      }>;
    },
  ) {
    const tenantId = user.tenantId;
    return this.settingsService.updateWorkingHours(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Auto-Replies
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('auto-replies')
  @ApiOperation({
    summary: 'الردود التلقائية',
    description: 'جلب إعدادات الردود التلقائية',
  })
  async getAutoReplies(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.settingsService.getAutoReplies(tenantId);
  }

  @Put('auto-replies')
  @ApiOperation({
    summary: 'تحديث الردود التلقائية',
    description: 'تحديث الردود التلقائية',
  })
  async updateAutoReplies(
    @CurrentUser() user: any,
    @Body() body: {
      welcomeMessage?: {
        enabled: boolean;
        message: string;
      };
      awayMessage?: {
        enabled: boolean;
        message: string;
      };
      closedMessage?: {
        enabled: boolean;
        message: string;
      };
      delayedResponse?: {
        enabled: boolean;
        delayMinutes: number;
        message: string;
      };
    },
  ) {
    const tenantId = user.tenantId;
    return this.settingsService.updateAutoReplies(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Team Settings
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('team')
  @ApiOperation({
    summary: 'إعدادات الفريق',
    description: 'جلب إعدادات الفريق وتوزيع المحادثات',
  })
  async getTeamSettings(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.settingsService.getTeamSettings(tenantId);
  }

  @Put('team')
  @ApiOperation({
    summary: 'تحديث إعدادات الفريق',
    description: 'تحديث إعدادات الفريق وتوزيع المحادثات',
  })
  async updateTeamSettings(
    @CurrentUser() user: any,
    @Body() body: {
      autoAssignment?: {
        enabled: boolean;
        method: 'round_robin' | 'load_balanced' | 'manual';
        maxConversationsPerAgent?: number;
      };
      idleTimeout?: number;
      allowAgentTakeOver?: boolean;
    },
  ) {
    const tenantId = user.tenantId;
    return this.settingsService.updateTeamSettings(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // All Settings
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'جميع الإعدادات',
    description: 'جلب جميع إعدادات الحساب',
  })
  async getAllSettings(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.settingsService.getAllSettings(tenantId);
  }
}
