/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Controller                        ║
 * ║                                                                                ║
 * ║  ✅ إصلاح: ترتيب Routes + endpoint تشخيصي                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { ChannelsService, ConnectWhatsAppOfficialDto, ConnectDiscordDto } from './channels.service';
import { WhatsAppBaileysService } from './whatsapp/whatsapp-baileys.service';

@ApiTags('Channels')
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly whatsappBaileysService: WhatsAppBaileysService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ إصلاح: Routes المحددة أولاً قبل :id
  // ═══════════════════════════════════════════════════════════════════════════════

  // 💬 WhatsApp Official
  @Post('whatsapp/official')
  @ApiOperation({ summary: 'Connect WhatsApp Business API' })
  async connectWhatsAppOfficial(
    @Body() body: ConnectWhatsAppOfficialDto & { storeId: string },
  ) {
    const { storeId, ...dto } = body;
    const channel = await this.channelsService.connectWhatsAppOfficial(storeId, dto);
    return { success: true, data: channel };
  }

  // 📱 WhatsApp QR (Baileys)
  @Post('whatsapp/qr/init')
  @ApiOperation({ summary: 'Initialize WhatsApp QR session' })
  async initWhatsAppQR(@Body() body: { storeId: string }) {
    const session = await this.channelsService.initWhatsAppSession(body.storeId);
    return { success: true, data: session };
  }

  @Get('whatsapp/qr/:sessionId/status')
  @ApiOperation({ summary: 'Get WhatsApp QR session status' })
  async getWhatsAppQRStatus(@Param('sessionId') sessionId: string) {
    const status = await this.channelsService.getWhatsAppSessionStatus(sessionId);
    return { success: true, data: status };
  }

  // ✅ Diagnostic endpoint
  @Get('whatsapp/qr/diagnostics')
  @ApiOperation({ summary: 'Get WhatsApp QR diagnostics' })
  async getWhatsAppDiagnostics() {
    return {
      success: true,
      data: this.whatsappBaileysService.getDiagnostics(),
    };
  }

  @Post('whatsapp/send')
  @ApiOperation({ summary: 'Send WhatsApp message' })
  async sendWhatsAppMessage(
    @Body() body: { channelId: string; to: string; message: string },
  ) {
    const result = await this.channelsService.sendWhatsAppMessage(
      body.channelId,
      body.to,
      body.message,
    );
    return { success: true, data: result };
  }

  // 📸 Instagram
  @Post('instagram')
  @ApiOperation({ summary: 'Connect Instagram account' })
  async connectInstagram(
    @Body() body: {
      storeId: string;
      accessToken: string;
      userId: string;
      pageId: string;
    },
  ) {
    const channel = await this.channelsService.connectInstagram(
      body.storeId,
      body.accessToken,
      body.userId,
      body.pageId,
    );
    return { success: true, data: channel };
  }

  // 🎮 Discord
  @Post('discord')
  @ApiOperation({ summary: 'Connect Discord bot' })
  async connectDiscord(
    @Body() body: ConnectDiscordDto & { storeId: string },
  ) {
    const { storeId, ...dto } = body;
    const channel = await this.channelsService.connectDiscord(storeId, dto);
    return { success: true, data: channel };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 Generic CRUD - ⚠️ يجب أن تكون في الأخير (بسبب :id parameter)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'Get all channels for a store' })
  @ApiQuery({ name: 'storeId', required: true })
  async getAll(@Query('storeId') storeId: string) {
    return {
      success: true,
      data: await this.channelsService.findAll(storeId),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  @ApiQuery({ name: 'storeId', required: true })
  async getById(
    @Param('id') id: string,
    @Query('storeId') storeId: string,
  ) {
    return {
      success: true,
      data: await this.channelsService.findById(id, storeId),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect a channel' })
  @ApiQuery({ name: 'storeId', required: true })
  async disconnect(
    @Param('id') id: string,
    @Query('storeId') storeId: string,
  ) {
    await this.channelsService.disconnect(id, storeId);
    return { success: true, message: 'Channel disconnected' };
  }
}
