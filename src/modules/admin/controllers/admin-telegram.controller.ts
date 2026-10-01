import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { PERMISSIONS } from '../entities/admin-user.entity';
import { TelegramOtpClientService, PREDEFINED_BOT_FLOWS } from '../../otp-relay/telegram-otp-client.service';

@Controller('admin/telegram')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@RequirePermissions(PERMISSIONS.TELEGRAM_MANAGE)
export class AdminTelegramController {
  constructor(private readonly telegramSvc: TelegramOtpClientService) {}

  @Get('status')
  getStatus() {
    return {
      available: this.telegramSvc.isAvailable(),
      hasApiId: !!process.env.TELEGRAM_API_ID,
      hasApiHash: !!process.env.TELEGRAM_API_HASH,
      hasSession: !!process.env.TELEGRAM_SESSION,
    };
  }

  @Get('bot-flows')
  getBotFlows() {
    return Object.entries(PREDEFINED_BOT_FLOWS).map(([id, f]) => ({
      id, label: f.label, description: f.description, botUsername: f.botUsername,
    }));
  }
}
