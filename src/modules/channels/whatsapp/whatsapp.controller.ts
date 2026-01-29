/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Controller                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { WhatsAppService, WhatsAppWebhookPayload } from './whatsapp.service';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 DTOs
// ═══════════════════════════════════════════════════════════════════════════════

class SendTextMessageDto {
  channelId: string;
  to: string;
  text: string;
}

class SendImageMessageDto {
  channelId: string;
  to: string;
  imageUrl: string;
  caption?: string;
}

class SendTemplateMessageDto {
  channelId: string;
  to: string;
  templateName: string;
  languageCode: string;
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{
      type: 'text' | 'image';
      text?: string;
      image?: { link: string };
    }>;
  }>;
}

class SendButtonMessageDto {
  channelId: string;
  to: string;
  bodyText: string;
  buttons: Array<{ id: string; title: string }>;
  headerText?: string;
  footerText?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎮 CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

@ApiTags('WhatsApp')
@Controller('channels/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsAppService: WhatsAppService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📤 SENDING MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('send/text')
  @ApiOperation({ summary: 'إرسال رسالة نصية عبر WhatsApp' })
  @ApiResponse({ status: 200, description: 'تم إرسال الرسالة بنجاح' })
  async sendTextMessage(
    @Body() dto: SendTextMessageDto,
  ) {
    this.logger.log(`Sending text message to ${dto.to}`, {
      channelId: dto.channelId,
    });

    const phoneNumberId = 'PHONE_NUMBER_ID';
    const accessToken = 'ACCESS_TOKEN';

    const result = await this.whatsAppService.sendTextMessage(
      phoneNumberId,
      dto.to,
      dto.text,
      accessToken,
    );

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  @Post('send/image')
  @ApiOperation({ summary: 'إرسال صورة عبر WhatsApp' })
  async sendImageMessage(
    @Body() dto: SendImageMessageDto,
  ) {
    const phoneNumberId = 'PHONE_NUMBER_ID';
    const accessToken = 'ACCESS_TOKEN';

    const result = await this.whatsAppService.sendImageMessage(
      phoneNumberId,
      dto.to,
      dto.imageUrl,
      dto.caption,
      accessToken,
    );

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  @Post('send/template')
  @ApiOperation({ summary: 'إرسال رسالة Template' })
  async sendTemplateMessage(
    @Body() dto: SendTemplateMessageDto,
  ) {
    const phoneNumberId = 'PHONE_NUMBER_ID';
    const accessToken = 'ACCESS_TOKEN';

    const result = await this.whatsAppService.sendTemplateMessage(
      phoneNumberId,
      dto.to,
      dto.templateName,
      dto.languageCode,
      dto.components,
      accessToken,
    );

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  @Post('send/buttons')
  @ApiOperation({ summary: 'إرسال رسالة بأزرار تفاعلية' })
  async sendButtonMessage(
    @Body() dto: SendButtonMessageDto,
  ) {
    const phoneNumberId = 'PHONE_NUMBER_ID';
    const accessToken = 'ACCESS_TOKEN';

    const result = await this.whatsAppService.sendButtonMessage(
      phoneNumberId,
      dto.to,
      dto.bodyText,
      dto.buttons,
      accessToken,
      dto.headerText,
      dto.footerText,
    );

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📥 WEBHOOKS
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('webhook')
  @ApiOperation({ summary: 'WhatsApp Webhook Verification' })
  @ApiResponse({ status: 200, description: 'Verification successful' })
  @ApiResponse({ status: 403, description: 'Verification failed' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    this.logger.log('WhatsApp webhook verification request', {
      mode,
      hasToken: !!token,
      hasChallenge: !!challenge,
    });

    const result = this.whatsAppService.verifyWebhook(mode, token, challenge);

    if (result) {
      return res.status(HttpStatus.OK).send(result);
    }

    return res.status(HttpStatus.FORBIDDEN).send('Verification failed');
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WhatsApp Webhook Handler' })
  async handleWebhook(
    @Body() payload: WhatsAppWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    const signature = req.headers['x-hub-signature-256'] as string;
    if (signature && req.rawBody) {
      const isValid = this.verifySignature(req.rawBody, signature);
      if (!isValid) {
        this.logger.warn('Invalid webhook signature', {
          signature: signature.substring(0, 20) + '...',
        });
        return;
      }
    }

    if (payload.object !== 'whatsapp_business_account') {
      this.logger.warn('Received non-WhatsApp webhook', {
        object: payload.object,
      });
      return;
    }

    try {
      const phoneNumberId = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

      if (!phoneNumberId) {
        this.logger.warn('Webhook missing phone_number_id');
        return;
      }

      const channelId = 'CHANNEL_ID';
      await this.whatsAppService.processWebhook(payload, channelId);

    } catch (error: any) {
      this.logger.error('Error processing WhatsApp webhook', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  @Post('webhook/:channelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Channel-specific WhatsApp Webhook' })
  async handleChannelWebhook(
    @Param('channelId') channelId: string,
    @Body() payload: WhatsAppWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    const signature = req.headers['x-hub-signature-256'] as string;
    if (signature && req.rawBody && !this.verifySignature(req.rawBody, signature)) {
      this.logger.warn('Invalid webhook signature for channel', { channelId });
      return;
    }

    if (payload.object !== 'whatsapp_business_account') {
      return;
    }

    try {
      await this.whatsAppService.processWebhook(payload, channelId);
    } catch (error: any) {
      this.logger.error('Error processing channel webhook', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  private verifySignature(rawBody: Buffer, signature: string): boolean {
    const crypto = require('crypto');
    const appSecret = process.env.WHATSAPP_APP_SECRET;

    if (!appSecret) {
      this.logger.warn('WHATSAPP_APP_SECRET not configured');
      return true;
    }

    const [algorithm, hash] = signature.split('=');

    if (algorithm !== 'sha256' || !hash) {
      return false;
    }

    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(expectedHash),
    );
  }
}
