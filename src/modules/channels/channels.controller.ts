/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Controller                        ║
 * ║                                                                                ║
 * ║  ✅ QR Code + Phone Pairing Code endpoints                                    ║
 * ║  ✅ Route ordering fix (specific routes before :id)                            ║
 * ║  ✅ Diagnostics endpoint                                                       ║
 * ║  ✅ New: ربط القناة بمتاجر / تنظيف القنوات المكررة                              ║
 * ║                                                                                ║
 * ║  📌 Audit: v2 - Added missing softDisconnect route                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { ChannelsService, ConnectWhatsAppOfficialDto, ConnectDiscordDto } from './channels.service';
import { WhatsAppBaileysService } from './whatsapp/whatsapp-baileys.service';

@ApiTags('Channels')
@UseGuards(JwtAuthGuard)
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly whatsappBaileysService: WhatsAppBaileysService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ Specific routes FIRST (before :id param)
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

  // 📱 WhatsApp QR Init
  @Post('whatsapp/qr/init')
  @ApiOperation({ summary: 'Initialize WhatsApp QR session' })
  async initWhatsAppQR(@Body() body: { storeId: string }) {
    const session = await this.channelsService.initWhatsAppSession(body.storeId);
    return { success: true, data: session };
  }


  // 📊 Diagnostics
  @Get('whatsapp/qr/diagnostics')
  @ApiOperation({ summary: 'WhatsApp QR diagnostics' })
  async getWhatsAppDiagnostics() {
    return { success: true, data: this.whatsappBaileysService.getDiagnostics() };
  }

  // 📊 QR Status
  @Get('whatsapp/qr/:sessionId/status')
  @ApiOperation({ summary: 'Get WhatsApp QR/Phone session status' })
  async getWhatsAppQRStatus(@Param('sessionId') sessionId: string) {
    const status = await this.channelsService.getWhatsAppSessionStatus(sessionId);
    return { success: true, data: status };
  }

  // 📨 Send Message
  @Post('whatsapp/send')
  @ApiOperation({ summary: 'Send WhatsApp message' })
  async sendWhatsAppMessage(
    @Body() body: { channelId: string; to: string; message: string },
  ) {
    const result = await this.channelsService.sendWhatsAppMessage(body.channelId, body.to, body.message);
    return { success: true, data: result };
  }

  // 📸 Instagram
  @Post('instagram')
  @ApiOperation({ summary: 'Connect Instagram account' })
  async connectInstagram(
    @Body() body: { storeId: string; accessToken: string; userId: string; pageId: string },
  ) {
    const channel = await this.channelsService.connectInstagram(body.storeId, body.accessToken, body.userId, body.pageId);
    return { success: true, data: channel };
  }

  // 🎮 Discord
  @Post('discord')
  @ApiOperation({ summary: 'Connect Discord bot' })
  async connectDiscord(@Body() body: ConnectDiscordDto & { storeId: string }) {
    const { storeId, ...dto } = body;
    const channel = await this.channelsService.connectDiscord(storeId, dto);
    return { success: true, data: channel };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Store Assignment - ربط القناة بمتاجر
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ نقل القناة من متجر لمتجر آخر
   * POST /channels/assign-store
   */
  @Post('assign-store')
  @ApiOperation({ summary: 'نقل قناة لمتجر آخر' })
  async assignToStore(
    @Body() body: { channelId: string; currentStoreId: string; newStoreId: string },
  ) {
    const channel = await this.channelsService.assignToStore(
      body.channelId,
      body.currentStoreId,
      body.newStoreId,
    );
    return { success: true, data: channel };
  }

  /**
   * ✅ مشاركة القناة مع عدة متاجر
   * POST /channels/share
   */
  @Post('share')
  @ApiOperation({ summary: 'مشاركة القناة مع عدة متاجر' })
  async shareWithStores(
    @Body() body: { channelId: string; storeId: string; targetStoreIds: string[] },
  ) {
    const channels = await this.channelsService.shareWithStores(
      body.channelId,
      body.storeId,
      body.targetStoreIds,
    );
    return {
      success: true,
      data: channels,
      message: `تم مشاركة القناة مع ${channels.length} متجر(متاجر)`,
    };
  }

  /**
   * ✅ إزالة مشاركة القناة من متجر
   * DELETE /channels/unshare/:channelId
   */
  @Delete('unshare/:channelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إزالة مشاركة القناة من متجر' })
  @ApiQuery({ name: 'storeId', required: true })
  async unshareFromStore(
    @Param('channelId') channelId: string,
    @Query('storeId') storeId: string,
  ) {
    await this.channelsService.unshareFromStore(channelId, storeId);
    return { success: true, message: 'تم إزالة المشاركة' };
  }

  /**
   * ✅ جلب المتاجر المرتبطة برقم معيّن
   * GET /channels/linked-stores?phone=971524395552
   */
  @Get('linked-stores')
  @ApiOperation({ summary: 'جلب المتاجر المرتبطة برقم واتساب' })
  @ApiQuery({ name: 'phone', required: true })
  async getLinkedStores(@Query('phone') phone: string) {
    const stores = await this.channelsService.getLinkedStores(phone);
    return { success: true, data: stores };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🧹 تنظيف القنوات المكررة
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ تنظيف القنوات المكررة/الميتة لمتجر معين
   * POST /channels/cleanup
   */
  @Post('cleanup')
  @ApiOperation({ summary: 'تنظيف القنوات المكررة والميتة' })
  async cleanupDeadChannels(@Body() body: { storeId: string }) {
    const result = await this.channelsService.cleanupDeadChannels(body.storeId);
    return {
      success: true,
      data: result,
      message: `تم حذف ${result.removed} قناة مكررة، والإبقاء على ${result.kept}`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 Generic CRUD - ⚠️ MUST be LAST (because of :id param)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'Get all channels for a store' })
  @ApiQuery({ name: 'storeId', required: true })
  async getAll(@Query('storeId') storeId: string) {
    return { success: true, data: await this.channelsService.findAll(storeId) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  @ApiQuery({ name: 'storeId', required: true })
  async getById(@Param('id') id: string, @Query('storeId') storeId: string) {
    return { success: true, data: await this.channelsService.findById(id, storeId) };
  }

  /**
   * ✅ فصل بدون حذف (السلوك القديم)
   * يبقي السجل في قاعدة البيانات لكن يغير الحالة لـ DISCONNECTED
   * PUT /channels/:id/soft-disconnect
   */
  @Put(':id/soft-disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect channel without deleting (keeps record)' })
  @ApiQuery({ name: 'storeId', required: true })
  async softDisconnect(@Param('id') id: string, @Query('storeId') storeId: string) {
    await this.channelsService.softDisconnect(id, storeId);
    return { success: true, message: 'Channel disconnected (record preserved)' };
  }

  /**
   * ✅ فصل مع حذف كامل (السلوك الجديد الافتراضي)
   * يحذف السجل نهائياً من قاعدة البيانات + يحذف جلسة Baileys
   * DELETE /channels/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect and permanently remove a channel' })
  @ApiQuery({ name: 'storeId', required: true })
  async disconnect(@Param('id') id: string, @Query('storeId') storeId: string) {
    await this.channelsService.disconnect(id, storeId);
    return { success: true, message: 'Channel disconnected and removed' };
  }
}
