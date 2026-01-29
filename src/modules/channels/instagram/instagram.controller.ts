/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Instagram Controller                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Response } from 'express';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { InstagramService } from './instagram.service';

@ApiTags('Channels - Instagram')
@Controller({
  path: 'channels/instagram',
  version: '1',
})
export class InstagramController {
  constructor(private readonly instagramService: InstagramService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // OAuth Flow
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط Instagram',
    description: 'بدء عملية OAuth للربط مع Instagram',
  })
  async connect(@Res() res: Response) {
    const tenantId = 'test-tenant-id';
    const authUrl = await this.instagramService.getAuthUrl(tenantId);
    res.redirect(authUrl);
  }

  @Get('callback')
  @ApiOperation({
    summary: 'Instagram OAuth Callback',
    description: 'معالجة رد Instagram بعد الموافقة',
  })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.instagramService.handleCallback(code, state);
      res.redirect(`/channels/success?platform=instagram&account=${result.username}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.redirect(`/channels/error?platform=instagram&error=${errorMessage}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Status & Disconnect
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'حالة الاتصال',
    description: 'التحقق من حالة اتصال Instagram',
  })
  async getStatus() {
    const tenantId = 'test-tenant-id';
    return this.instagramService.getConnectionStatus(tenantId);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'فصل Instagram',
    description: 'فصل الربط مع Instagram',
  })
  async disconnect() {
    const tenantId = 'test-tenant-id';
    await this.instagramService.disconnect(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Messaging
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال رسالة',
    description: 'إرسال رسالة عبر Instagram DM',
  })
  async sendMessage(
    @Body() body: {
      recipientId: string;
      message: string;
      mediaUrl?: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.instagramService.sendDirectMessage(
      tenantId,
      body.recipientId,
      body.message,
      body.mediaUrl,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Webhook
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('webhook')
  @ApiOperation({
    summary: 'Webhook Verification',
    description: 'التحقق من Webhook بواسطة Meta',
  })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.instagramService.verifyWebhook(mode, token, challenge);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'استقبال Webhook',
    description: 'استقبال الرسائل والأحداث من Instagram',
  })
  async handleWebhook(@Body() body: unknown) {
    await this.instagramService.handleWebhook(body);
    return 'OK';
  }
}
