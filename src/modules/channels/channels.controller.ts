/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Controller                        ║
 * ║                                                                                ║
 * ║  API endpoints لإدارة قنوات التواصل                                           ║
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
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

// Guards
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Services
import { ChannelsService, ConnectWhatsAppOfficialDto, ConnectDiscordDto } from './channels.service';

// ═══════════════════════════════════════════════════════════════════════════════
// Request DTOs
// ═══════════════════════════════════════════════════════════════════════════════

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    tenantId: string;
  };
}

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(private readonly channelsService: ChannelsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /channels
   * جلب جميع القنوات للمتجر
   */
  @Get()
  async findAll(
    @Query('storeId') storeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.log(`Fetching channels for store ${storeId}`);
    
    const channels = await this.channelsService.findAll(storeId);
    
    return {
      success: true,
      data: channels,
    };
  }

  /**
   * GET /channels/:id
   * جلب قناة محددة
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query('storeId') storeId: string,
  ) {
    const channel = await this.channelsService.findById(id, storeId);
    
    return {
      success: true,
      data: channel,
    };
  }

  /**
   * DELETE /channels/:id
   * فصل قناة
   */
  @Delete(':id')
  async disconnect(
    @Param('id') id: string,
    @Query('storeId') storeId: string,
  ) {
    await this.channelsService.disconnect(id, storeId);
    
    return {
      success: true,
      message: 'Channel disconnected',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 WhatsApp Official
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /channels/whatsapp/official
   * ربط WhatsApp Business API
   */
  @Post('whatsapp/official')
  async connectWhatsAppOfficial(
    @Body() dto: ConnectWhatsAppOfficialDto & { storeId: string },
  ) {
    this.logger.log(`Connecting WhatsApp Official for store ${dto.storeId}`);
    
    const channel = await this.channelsService.connectWhatsAppOfficial(
      dto.storeId,
      dto,
    );
    
    return {
      success: true,
      data: channel,
      message: 'WhatsApp Business connected successfully',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Unofficial (QR)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /channels/whatsapp/qr/init
   * بدء جلسة WhatsApp QR
   */
  @Post('whatsapp/qr/init')
  async initWhatsAppQR(@Body('storeId') storeId: string) {
    this.logger.log(`Initializing WhatsApp QR for store ${storeId}`);
    
    const session = await this.channelsService.initWhatsAppSession(storeId);
    
    return {
      success: true,
      data: session,
    };
  }

  /**
   * GET /channels/whatsapp/qr/:sessionId/status
   * حالة جلسة WhatsApp QR
   */
  @Get('whatsapp/qr/:sessionId/status')
  async getWhatsAppQRStatus(@Param('sessionId') sessionId: string) {
    const session = await this.channelsService.getWhatsAppSessionStatus(sessionId);
    
    return {
      success: true,
      data: session,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📸 Instagram
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /channels/instagram
   * ربط انستقرام (بعد OAuth callback)
   */
  @Post('instagram')
  async connectInstagram(
    @Body() dto: {
      storeId: string;
      accessToken: string;
      userId: string;
      pageId: string;
    },
  ) {
    this.logger.log(`Connecting Instagram for store ${dto.storeId}`);
    
    const channel = await this.channelsService.connectInstagram(
      dto.storeId,
      dto.accessToken,
      dto.userId,
      dto.pageId,
    );
    
    return {
      success: true,
      data: channel,
      message: 'Instagram connected successfully',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 Discord
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /channels/discord
   * ربط Discord Bot
   */
  @Post('discord')
  async connectDiscord(@Body() dto: ConnectDiscordDto & { storeId: string }) {
    this.logger.log(`Connecting Discord for store ${dto.storeId}`);
    
    const channel = await this.channelsService.connectDiscord(dto.storeId, dto);
    
    return {
      success: true,
      data: channel,
      message: 'Discord bot connected successfully',
    };
  }
}
