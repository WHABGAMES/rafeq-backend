/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Controller                              ║
 * ║                                                                                ║
 * ║  ✅ إصلاحات:                                                                   ║
 * ║  - إزالة جميع القيم الوهمية (PHONE_NUMBER_ID, ACCESS_TOKEN, CHANNEL_ID)       ║
 * ║  - حقن Channel Repository للبحث في قاعدة البيانات                              ║
 * ║  - نقل التحقق من التوقيع قبل إرسال 200 OK                                     ║
 * ║  - استخدام ConfigService لمتغيرات البيئة                                       ║
 * ║  - توحيد مسار الإرسال مع ChannelsService                                      ║
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
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { WhatsAppService, WhatsAppWebhookPayload } from './whatsapp.service';
import { Channel, ChannelType, ChannelStatus } from '../entities/channel.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WhatsappSettings } from '../../admin/entities/whatsapp-settings.entity';

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
    private readonly configService: ConfigService,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    @InjectRepository(WhatsappSettings)
    private readonly whatsappSettingsRepo: Repository<WhatsappSettings>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 HELPER: البحث عن القناة والتحقق منها
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * البحث عن قناة WhatsApp Official بالـ channelId واسترجاع credentials
   */
  private async getChannelCredentials(channelId: string): Promise<{
    phoneNumberId: string;
    accessToken: string;
    channel: Channel;
  }> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId, type: ChannelType.WHATSAPP_OFFICIAL },
    });

    if (!channel) {
      throw new NotFoundException(`Channel not found: ${channelId}`);
    }

    if (channel.status !== ChannelStatus.CONNECTED) {
      throw new BadRequestException(`Channel is not connected: ${channel.status}`);
    }

    if (!channel.whatsappPhoneNumberId || !channel.whatsappAccessToken) {
      throw new BadRequestException('Channel missing WhatsApp credentials. Please reconnect.');
    }

    return {
      phoneNumberId: channel.whatsappPhoneNumberId,
      accessToken: channel.whatsappAccessToken,
      channel,
    };
  }

  /**
   * البحث عن قناة بواسطة phoneNumberId (للـ Webhooks)
   */
  private async findChannelByPhoneNumberId(phoneNumberId: string): Promise<Channel | null> {
    return this.channelRepository.findOne({
      where: {
        whatsappPhoneNumberId: phoneNumberId,
        type: ChannelType.WHATSAPP_OFFICIAL,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📤 SENDING MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════════

  @UseGuards(JwtAuthGuard)
  @Post('send/text')
  @ApiOperation({ summary: 'إرسال رسالة نصية عبر WhatsApp' })
  @ApiResponse({ status: 200, description: 'تم إرسال الرسالة بنجاح' })
  async sendTextMessage(
    @Body() dto: SendTextMessageDto,
  ) {
    this.logger.log(`Sending text message to ${dto.to}`, {
      channelId: dto.channelId,
    });

    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);

    const result = await this.whatsAppService.sendTextMessage(
      phoneNumberId,
      dto.to,
      dto.text,
      accessToken,
    );

    // تحديث إحصائيات القناة
    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('send/image')
  @ApiOperation({ summary: 'إرسال صورة عبر WhatsApp' })
  async sendImageMessage(
    @Body() dto: SendImageMessageDto,
  ) {
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);

    const result = await this.whatsAppService.sendImageMessage(
      phoneNumberId,
      dto.to,
      dto.imageUrl,
      dto.caption,
      accessToken,
    );

    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('send/template')
  @ApiOperation({ summary: 'إرسال رسالة Template' })
  async sendTemplateMessage(
    @Body() dto: SendTemplateMessageDto,
  ) {
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);

    const result = await this.whatsAppService.sendTemplateMessage(
      phoneNumberId,
      dto.to,
      dto.templateName,
      dto.languageCode,
      dto.components,
      accessToken,
    );

    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });

    return {
      success: true,
      messageId: result.messages[0]?.id,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('send/buttons')
  @ApiOperation({ summary: 'إرسال رسالة بأزرار تفاعلية' })
  async sendButtonMessage(
    @Body() dto: SendButtonMessageDto,
  ) {
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);

    const result = await this.whatsAppService.sendButtonMessage(
      phoneNumberId,
      dto.to,
      dto.bodyText,
      dto.buttons,
      accessToken,
      dto.headerText,
      dto.footerText,
    );

    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });

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
    // ─── التحقق من التوقيع ────────────────────────────────────────────────────
    // نتحقق باستخدام rawBody أولاً، ثم JSON.stringify كـ fallback
    // (Cloudflare قد يُعدّل whitespace مما يُفشل rawBody لكن ليس JSON)
    const signature = req.headers['x-hub-signature-256'] as string;
    if (signature) {
      const rawBodyBuffer = req.rawBody;
      const jsonBodyBuffer = Buffer.from(JSON.stringify(payload));

      const validRaw = rawBodyBuffer ? this.verifySignature(rawBodyBuffer, signature) : false;
      const validJson = this.verifySignature(jsonBodyBuffer, signature);

      if (!validRaw && !validJson) {
        // META_APP_SECRET مضبوط ولكن التوقيع لا يتطابق — رفض الطلب
        const appSecret = this.configService.get<string>('whatsapp.appSecret');
        if (appSecret) {
          this.logger.warn('Invalid webhook signature — rejecting', {
            signature: signature.substring(0, 20) + '...',
            hasRawBody: !!rawBodyBuffer,
          });
          res.status(HttpStatus.UNAUTHORIZED).send('Invalid signature');
          return;
        }
        // إذا لم يكن appSecret مضبوطاً نسمح بالمرور مع تحذير
        this.logger.warn('META_APP_SECRET not configured — skipping signature check');
      }
    }

    // ─── إرسال 200 OK فوراً ──────────────────────────────────────────────────
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    if (payload.object !== 'whatsapp_business_account') {
      this.logger.warn('Received non-WhatsApp webhook', { object: payload.object });
      return;
    }

    try {
      const phoneNumberId = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

      if (!phoneNumberId) {
        this.logger.warn('Webhook missing phone_number_id');
        return;
      }

      // ─── 1. بحث في قنوات المتاجر ────────────────────────────────────────────
      const channel = await this.findChannelByPhoneNumberId(phoneNumberId);

      if (channel) {
        this.logger.log('Processing webhook for store channel', {
          channelId: channel.id,
          phoneNumberId,
        });
        await this.whatsAppService.processWebhook(payload, channel.id);
        const messagesCount = payload.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0;
        if (messagesCount > 0) {
          await this.channelRepository.increment({ id: channel.id }, 'messagesReceived', messagesCount);
          await this.channelRepository.update(channel.id, { lastActivityAt: new Date() });
        }
        return;
      }

      // ─── 2. بحث في إعدادات WhatsApp الإدارية ────────────────────────────────
      // رقم الإدارة يُستخدم للإشعارات الصادرة فقط — نعالج status updates فقط
      const adminSettings = await this.whatsappSettingsRepo.findOne({ where: {} });
      if (adminSettings?.phoneNumberId === phoneNumberId) {
        this.logger.log('Processing status updates for admin WhatsApp', { phoneNumberId });

        // معالجة status updates فقط (delivered/read/failed للإشعارات المُرسَلة)
        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            const statuses = change.value?.statuses || [];
            for (const status of statuses) {
              this.logger.debug(`Admin WhatsApp status: ${status.status} for message ${status.id}`);
              // TODO: تحديث message_logs عند توفر messageId
            }
          }
        }
        return;
      }

      this.logger.warn('No channel found for phone_number_id', { phoneNumberId });

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
    // التحقق من التوقيع (rawBody أو JSON fallback)
    const signature = req.headers['x-hub-signature-256'] as string;
    if (signature) {
      const rawBodyBuffer = req.rawBody;
      const jsonBodyBuffer = Buffer.from(JSON.stringify(payload));
      const validRaw = rawBodyBuffer ? this.verifySignature(rawBodyBuffer, signature) : false;
      const validJson = this.verifySignature(jsonBodyBuffer, signature);

      if (!validRaw && !validJson) {
        const appSecret = this.configService.get<string>('whatsapp.appSecret');
        if (appSecret) {
          this.logger.warn('Invalid webhook signature for channel', { channelId });
          res.status(HttpStatus.UNAUTHORIZED).send('Invalid signature');
          return;
        }
      }
    }

    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    if (payload.object !== 'whatsapp_business_account') {
      return;
    }

    const channel = await this.channelRepository.findOne({
      where: { id: channelId, type: ChannelType.WHATSAPP_OFFICIAL },
    });

    if (!channel) {
      this.logger.warn('Channel-specific webhook: channel not found', { channelId });
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

  /**
   * ✅ إصلاح #7: استخدام ConfigService + META_APP_SECRET الموحد
   */
  private verifySignature(rawBody: Buffer, signature: string): boolean {
    const appSecret = this.configService.get<string>('whatsapp.appSecret');

    if (!appSecret) {
      const isProduction = this.configService.get<string>('app.env') === 'production';
      if (isProduction) {
        this.logger.error('🚨 META_APP_SECRET not configured in PRODUCTION - rejecting webhook');
        return false;
      }
      this.logger.warn('META_APP_SECRET not configured (dev mode) - skipping signature verification');
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

    try {
      return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(expectedHash),
      );
    } catch {
      return false;
    }
  }
}
