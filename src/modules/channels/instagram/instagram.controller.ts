/**
 * RAFIQ PLATFORM - Instagram Controller
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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { InstagramService } from './instagram.service';

@ApiTags('Channels - Instagram')
@Controller({ path: 'channels/instagram', version: '1' })
export class InstagramController {
  constructor(private readonly instagramService: InstagramService) {}

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'ربط Instagram' })
  async connect(@Res() res: Response) {
    const tenantId = 'test-tenant-id';
    const authUrl = await this.instagramService.getAuthUrl(tenantId);
    res.redirect(authUrl);
  }

  @Get('callback')
  @ApiOperation({ summary: 'Instagram OAuth Callback' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.instagramService.handleCallback(code, state);
      res.redirect(`/channels/success?platform=instagram&tenantId=${result.tenantId}`);
    } catch (error: any) {
      res.redirect(`/channels/error?platform=instagram&error=${error?.message || 'Unknown'}`);
    }
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'حالة الاتصال' })
  async getStatus() {
    const tenantId = 'test-tenant-id';
    return this.instagramService.getConnectionStatus(tenantId);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'فصل Instagram' })
  async disconnect() {
    const tenantId = 'test-tenant-id';
    await this.instagramService.disconnect(tenantId);
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'إرسال رسالة' })
  async sendMessage(@Body() body: { recipientId: string; message: string }) {
    const tenantId = 'test-tenant-id';
    return this.instagramService.send(tenantId, body.recipientId, body.message);
  }

  @Get('webhook')
  @ApiOperation({ summary: 'Webhook Verification' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') _token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe') return challenge;
    return 'Verification failed';
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'استقبال Webhook' })
  async handleWebhook(@Body() body: any) {
    await this.instagramService.handleWebhook(body);
    return 'OK';
  }
}
