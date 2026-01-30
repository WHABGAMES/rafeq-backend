/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Telegram Controller                              ║
 * ║                                                                                ║
 * ║  📌 إدارة قناة Telegram Bot                                                    ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  POST   /channels/telegram/connect      → ربط البوت                           ║
 * ║  GET    /channels/telegram/status       → حالة الاتصال                        ║
 * ║  POST   /channels/telegram/send         → إرسال رسالة                         ║
 * ║  POST   /channels/telegram/webhook      → استقبال Webhook                     ║
 * ║  DELETE /channels/telegram/disconnect   → فصل الاتصال                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  
  ApiBearerAuth,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TelegramService } from './telegram.service';

@ApiTags('Channels - Telegram')
@Controller({
  path: 'channels/telegram',
  version: '1',
})
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط Telegram Bot',
    description: 'ربط بوت تيليجرام باستخدام Bot Token',
  })
  async connect(@CurrentUser() user: any,
    @Body() body: { botToken: string }) {
    const tenantId = user.tenantId;
    return this.telegramService.connect(tenantId, body.botToken);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'حالة الاتصال',
    description: 'التحقق من حالة بوت تيليجرام',
  })
  async getStatus(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    return this.telegramService.getStatus(tenantId);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'فصل Telegram',
    description: 'فصل الربط مع بوت تيليجرام',
  })
  async disconnect(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
    await this.telegramService.disconnect(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Messaging
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال رسالة',
    description: 'إرسال رسالة عبر Telegram',
  })
  async sendMessage(
    @CurrentUser() user: any,
    @Body() body: {
      chatId: string;
      text: string;
      parseMode?: 'HTML' | 'Markdown';
      replyMarkup?: any;
    },
  ) {
    const tenantId = user.tenantId;
    return this.telegramService.sendMessage(tenantId, body);
  }

  @Post('send-photo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'إرسال صورة' })
  async sendPhoto(
    @CurrentUser() user: any,
    @Body() body: {
      chatId: string;
      photo: string;
      caption?: string;
    },
  ) {
    const tenantId = user.tenantId;
    return this.telegramService.sendPhoto(tenantId, body);
  }

  @Post('send-document')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'إرسال ملف' })
  async sendDocument(
    @CurrentUser() user: any,
    @Body() body: {
      chatId: string;
      document: string;
      caption?: string;
    },
  ) {
    const tenantId = user.tenantId;
    return this.telegramService.sendDocument(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Webhook
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('webhook/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'استقبال Webhook',
    description: 'استقبال التحديثات من Telegram',
  })
  async handleWebhook(
    @CurrentUser() user: any,
    @Param('token') token: string,
    @Body() update: any,
  ) {
    await this.telegramService.handleUpdate(token, update);
    return 'OK';
  }

  @Post('set-webhook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تعيين Webhook',
    description: 'تعيين رابط Webhook للبوت',
  })
  async setWebhook(@CurrentUser() user: any,
    @Body() body: { url: string }) {
    const tenantId = user.tenantId;
    return this.telegramService.setWebhook(tenantId, body.url);
  }
}
