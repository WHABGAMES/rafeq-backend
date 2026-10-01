/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Admin Platform Notifications Controller             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 *
 * المسار: src/modules/platform-notifications/admin-platform-notifications.controller.ts
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
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

// ✅ Relative imports داخل نفس الـ module
import { PlatformNotificationsService } from './platform-notifications.service';
import {
  CreatePlatformNotificationDto,
  UpdatePlatformNotificationDto,
} from './dto/platform-notification.dto';
import {
  PlatformNotificationType,
} from './platform-notification.entity';

// ✅ Admin guards — مسار صحيح من modules/platform-notifications
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions, Require2FA } from '@modules/admin/guards/admin.guards';
import { CurrentAdmin } from '@modules/admin/decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '@modules/admin/entities/admin-user.entity';

@ApiTags('Admin: إشعارات المنصة')
@Controller('admin/platform-notifications')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@RequirePermissions(PERMISSIONS.PLATFORM_NOTIFICATIONS_MANAGE)
export class AdminPlatformNotificationsController {
  constructor(private readonly service: PlatformNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة جميع الإشعارات' })
  async findAll(
    @Query('type') type?: PlatformNotificationType,
    @Query('isActive') isActive?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    return this.service.findAll({
      type,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل إشعار' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Require2FA()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء إشعار جديد' })
  async create(
    @Body() body: CreatePlatformNotificationDto,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.service.create(body, admin.id);
  }

  @Patch(':id')
  @Require2FA()
  @ApiOperation({ summary: 'تعديل إشعار' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlatformNotificationDto,
  ) {
    return this.service.update(id, body);
  }

  @Patch(':id/toggle')
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تفعيل/إيقاف إشعار' })
  async toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.toggleActive(id);
  }

  @Delete(':id')
  @Require2FA()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف إشعار' })
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.delete(id);
  }
}
