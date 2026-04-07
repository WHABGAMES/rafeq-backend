import { Controller, Get, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { AdminJwtGuard, AdminPermissionGuard } from '../guards/admin.guards';
import { TelegramOtpClientService, PREDEFINED_BOT_FLOWS } from '../../otp-relay/telegram-otp-client.service';

@Controller('admin/telegram')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
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

  @Post('auth/start')
  async startAuth(@Body() b: { apiId: number; apiHash: string; phone: string }) {
    if (!b.apiId || !b.apiHash || !b.phone) throw new BadRequestException('جميع الحقول مطلوبة');
    const result = await this.telegramSvc.startAuth(b.apiId, b.apiHash, b.phone);
    return { success: true, phoneCodeHash: result.phoneCodeHash, message: 'تم إرسال كود التحقق لـ Telegram' };
  }

  @Post('auth/complete')
  async completeAuth(@Body() b: { code: string; phoneCodeHash: string }) {
    if (!b.code || !b.phoneCodeHash) throw new BadRequestException('الكود مطلوب');
    const result = await this.telegramSvc.completeAuth(b.code, b.phoneCodeHash);
    return { success: true, sessionString: result.sessionString, message: 'تم تسجيل الدخول بنجاح! أضف هذا الـ session للـ ENV' };
  }

  @Get('bot-flows')
  getBotFlows() {
    return Object.entries(PREDEFINED_BOT_FLOWS).map(([id, f]) => ({
      id, label: f.label, description: f.description, botUsername: f.botUsername,
    }));
  }
}
