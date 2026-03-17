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
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

// ✅ Relative imports داخل نفس الـ module
import { PlatformNotificationsService } from './platform-notifications.service';
import {
  PlatformNotificationType,
  PlatformNotificationDisplay,
  PlatformNotificationColor,
} from './platform-notification.entity';

// ✅ Admin guards — مسار صحيح من modules/platform-notifications
import { AdminJwtGuard, AdminPermissionGuard } from '@modules/admin/guards/admin.guards';
import { CurrentAdmin } from '@modules/admin/decorators/current-admin.decorator';

@ApiTags('Admin: إشعارات المنصة')
@Controller('admin/platform-notifications')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AdminPlatformNotificationsController {
  constructor(private readonly service: PlatformNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'قائمة جميع الإشعارات' })
  async findAll(
    @Query('type') type?: PlatformNotificationType,
    @Query('isActive') isActive?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
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
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء إشعار جديد' })
  async create(@Body() body: any, @CurrentAdmin() admin: any) {
    return this.service.create(body, admin?.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'تعديل إشعار' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Patch(':id/toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تفعيل/إيقاف إشعار' })
  async toggleActive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.toggleActive(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف إشعار' })
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.delete(id);
  }
}
