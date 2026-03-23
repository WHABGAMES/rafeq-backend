/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Public Platform Notifications Controller            ║
 * ║          للتجار — يجلب الإشعارات النشطة المناسبة لهم                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

// ✅ مسارات صحيحة باستخدام path aliases المعرّفة في tsconfig.json
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { PlatformNotificationsService } from './platform-notifications.service';

@ApiTags('Platform Notifications')
@Controller('platform-notifications')
@UseGuards(JwtAuthGuard)
export class PlatformNotificationsPublicController {
  constructor(private readonly service: PlatformNotificationsService) {}

  /**
   * التاجر يجلب الإشعارات النشطة له
   * plan يُقرأ من user.tenant.subscriptionPlan (محمَّل في JwtStrategy)
   */
  @Get('active')
  @ApiOperation({ summary: 'الإشعارات النشطة للتاجر' })
  async getActive(
    @CurrentUser() user: any,
    @Query('page') page?: string,
  ) {
    const plan = user?.tenant?.subscriptionPlan || 'free';
    const userId = user?.id || user?.sub;
    const notifications = await this.service.getActiveForMerchant({ plan, page, userId });
    return { notifications };
  }

  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'تسجيل مشاهدة إشعار' })
  async trackView(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<void> {
    const userId = user?.id || user?.sub;
    await this.service.trackView(id, userId).catch(() => {});
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'تسجيل رفض إشعار' })
  async trackDismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<void> {
    const userId = user?.id || user?.sub;
    await this.service.trackDismissal(id, userId).catch(() => {});
  }
}
