/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Controller                              ║
 * ║                                                                                ║
 * ║  ✅ FIX WH-01: rawBody preservation in main.ts (companion fix)                ║
 * ║  ✅ FIX WH-02: Webhook signature verification — جذري ونهائي                   ║
 * ║                                                                                ║
 * ║  المشكلة القديمة:                                                              ║
 * ║  1. التحقق من التوقيع يحدث قبل إرسال 200 OK                                  ║
 * ║     → Meta تُرسل 401 → تعيد المحاولة لـ 24 ساعة → عاصفة لا تنتهي            ║
 * ║  2. rawBody كان فارغاً بسبب double body-parsing في main.ts                   ║
 * ║     → كلا الـ rawBody و JSON.stringify يفشلان في التحقق                      ║
 * ║  3. JSON.stringify(payload) ينتج bytes مختلفة عما وقّعته Meta               ║
 * ║     → لا يصح استخدامه كـ fallback أبداً                                      ║
 * ║                                                                                ║
 * ║  الحل الجذري:                                                                  ║
 * ║  1. إرسال 200 OK فوراً (Meta requirement)                                     ║
 * ║  2. التحقق من rawBody الحقيقي فقط (مصلح في main.ts)                          ║
 * ║  3. تسجيل تفصيلي لتشخيص أي مشاكل مستقبلية                                   ║
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
  // 🔐 SIGNATURE VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * التحقق من توقيع Meta Webhook.
   *
   * استراتيجية التحقق الصحيحة:
   * - نستخدم rawBody الحقيقي فقط (البايتات الأصلية كما أرسلتها Meta)
   * - لا نستخدم JSON.stringify كـ fallback — يُنتج bytes مختلفة دائماً
   *
   * @returns { valid, reason } للتشخيص الدقيق
   */
  private verifySignature(
    rawBody: Buffer | undefined,
    signature: string,
    context: string,
  ): { valid: boolean; reason: string } {
    const appSecret = this.configService.get<string>('whatsapp.appSecret');

    if (!appSecret) {
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction) {
        return { valid: false, reason: 'META_APP_SECRET not configured in PRODUCTION' };
      }
      return { valid: true, reason: 'dev-mode-no-secret' };
    }

    if (!rawBody || rawBody.length === 0) {
      return {
        valid: false,
        reason: `rawBody is empty for [${context}] — body parser not preserving rawBody`,
      };
    }

    const eqIndex = signature.indexOf('=');
    if (eqIndex === -1) {
      return { valid: false, reason: `malformed signature header: ${signature.substring(0, 30)}` };
    }

    const algorithm = signature.substring(0, eqIndex);
    const receivedHash = signature.substring(eqIndex + 1);

    if (algorithm !== 'sha256') {
      return { valid: false, reason: `unsupported algorithm: ${algorithm}` };
    }

    if (!receivedHash || receivedHash.length !== 64) {
      return { valid: false, reason: `invalid hash length: ${receivedHash?.length} (expected 64)` };
    }

    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    try {
      // مقارنة آمنة زمنياً (hex → bytes ثم compare)
      const receivedBuf = Buffer.from(receivedHash, 'hex');
      const expectedBuf = Buffer.from(expectedHash, 'hex');

      if (receivedBuf.length !== expectedBuf.length) {
        return {
          valid: false,
          reason: `buffer length mismatch: ${receivedBuf.length} vs ${expectedBuf.length}`,
        };
      }

      const isValid = crypto.timingSafeEqual(receivedBuf, expectedBuf);
      return {
        valid: isValid,
        reason: isValid
          ? 'ok'
          : `hash-mismatch: got=${receivedHash.substring(0, 16)}... want=${expectedHash.substring(0, 16)}...`,
      };
    } catch (err) {
      return {
        valid: false,
        reason: `comparison error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * يُقرر إذا يجب معالجة الـ payload بناءً على نتيجة التحقق.
   * يسجل تشخيص كافٍ لأي حالة فشل.
   */
  private shouldProcessWebhook(
    result: { valid: boolean; reason: string },
    context: string,
    rawBodySize: number,
  ): boolean {
    if (result.valid) {
      if (result.reason !== 'dev-mode-no-secret') {
        this.logger.log(`✅ [${context}] Signature valid — rawBody: ${rawBodySize}B`);
      }
      return true;
    }

    this.logger.error(`🚨 [${context}] Signature FAILED — payload ignored`, {
      reason: result.reason,
      rawBodySize,
      hint: 'Verify META_APP_SECRET matches the App Secret in Meta App Dashboard → Basic Settings',
    });
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  private async getChannelCredentials(channelId: string): Promise<{
    phoneNumberId: string;
    accessToken: string;
    channel: Channel;
  }> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId, type: ChannelType.WHATSAPP_OFFICIAL },
    });

    if (!channel) throw new NotFoundException(`Channel not found: ${channelId}`);
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

  private async findChannelByPhoneNumberId(phoneNumberId: string): Promise<Channel | null> {
    return this.channelRepository.findOne({
      where: { whatsappPhoneNumberId: phoneNumberId, type: ChannelType.WHATSAPP_OFFICIAL },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📤 SENDING MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════════

  @UseGuards(JwtAuthGuard)
  @Post('send/text')
  @ApiOperation({ summary: 'إرسال رسالة نصية عبر WhatsApp' })
  async sendTextMessage(@Body() dto: SendTextMessageDto) {
    this.logger.log(`Sending text to ${dto.to}`, { channelId: dto.channelId });
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);
    const result = await this.whatsAppService.sendTextMessage(phoneNumberId, dto.to, dto.text, accessToken);
    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });
    return { success: true, messageId: result.messages[0]?.id };
  }

  @UseGuards(JwtAuthGuard)
  @Post('send/image')
  @ApiOperation({ summary: 'إرسال صورة عبر WhatsApp' })
  async sendImageMessage(@Body() dto: SendImageMessageDto) {
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);
    const result = await this.whatsAppService.sendImageMessage(phoneNumberId, dto.to, dto.imageUrl, dto.caption, accessToken);
    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });
    return { success: true, messageId: result.messages[0]?.id };
  }

  @UseGuards(JwtAuthGuard)
  @Post('send/template')
  @ApiOperation({ summary: 'إرسال رسالة Template' })
  async sendTemplateMessage(@Body() dto: SendTemplateMessageDto) {
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);
    const result = await this.whatsAppService.sendTemplateMessage(
      phoneNumberId, dto.to, dto.templateName, dto.languageCode, dto.components, accessToken,
    );
    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });
    return { success: true, messageId: result.messages[0]?.id };
  }

  @UseGuards(JwtAuthGuard)
  @Post('send/buttons')
  @ApiOperation({ summary: 'إرسال رسالة بأزرار تفاعلية' })
  async sendButtonMessage(@Body() dto: SendButtonMessageDto) {
    const { phoneNumberId, accessToken } = await this.getChannelCredentials(dto.channelId);
    const result = await this.whatsAppService.sendButtonMessage(
      phoneNumberId, dto.to, dto.bodyText, dto.buttons, accessToken, dto.headerText, dto.footerText,
    );
    await this.channelRepository.increment({ id: dto.channelId }, 'messagesSent', 1);
    await this.channelRepository.update(dto.channelId, { lastActivityAt: new Date() });
    return { success: true, messageId: result.messages[0]?.id };
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
    this.logger.log('Webhook verification request', { mode, hasToken: !!token });
    const result = this.whatsAppService.verifyWebhook(mode, token, challenge);
    if (result) return res.status(HttpStatus.OK).send(result);
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
    // ─── FIX WH-02: إرسال 200 OK فوراً — Meta requirement ────────────────────
    // إذا تأخرنا أو أرسلنا 4xx → Meta تُعيد المحاولة كل دقيقة لـ 24 ساعة
    // يُسبب عاصفة من الطلبات تُثقل السيرفر وقاعدة البيانات
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    // ─── التحقق من التوقيع بعد إرسال 200 ────────────────────────────────────
    // الأمان الحقيقي: نتحقق ونتجاهل إذا فشل — بدون أن تعلم Meta
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (signature) {
      const rawBodyBuffer = req.rawBody;
      const result = this.verifySignature(rawBodyBuffer, signature, 'handleWebhook');
      if (!this.shouldProcessWebhook(result, 'handleWebhook', rawBodyBuffer?.length ?? 0)) {
        return; // تجاهل payload — 200 أُرسل بالفعل
      }
    } else {
      this.logger.warn('handleWebhook: no x-hub-signature-256 header');
    }

    if (payload.object !== 'whatsapp_business_account') {
      this.logger.warn('Non-WhatsApp webhook', { object: payload.object });
      return;
    }

    try {
      const phoneNumberId = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

      if (!phoneNumberId) {
        this.logger.warn('Webhook missing phone_number_id');
        return;
      }

      // ─── 1. قنوات المتاجر ──────────────────────────────────────────────────
      const channel = await this.findChannelByPhoneNumberId(phoneNumberId);

      if (channel) {
        this.logger.log('Processing webhook for store', { channelId: channel.id, phoneNumberId });
        await this.whatsAppService.processWebhook(payload, channel.id);

        const messagesCount = payload.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0;
        if (messagesCount > 0) {
          await this.channelRepository.increment({ id: channel.id }, 'messagesReceived', messagesCount);
          await this.channelRepository.update(channel.id, { lastActivityAt: new Date() });
        }
        return;
      }

      // ─── 2. إعدادات WhatsApp الإدارية ─────────────────────────────────────
      const adminSettings = await this.whatsappSettingsRepo.findOne({ where: {} });
      if (adminSettings?.phoneNumberId === phoneNumberId) {
        this.logger.log('Processing admin WhatsApp status updates', { phoneNumberId });
        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            for (const status of change.value?.statuses || []) {
              this.logger.debug(`Admin status: ${status.status} for msg ${status.id}`);
            }
          }
        }
        return;
      }

      this.logger.warn('No channel found for phone_number_id', { phoneNumberId });

    } catch (error: unknown) {
      this.logger.error('Error processing webhook', {
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
    // ─── FIX WH-02: 200 OK فوراً ──────────────────────────────────────────────
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (signature) {
      const rawBodyBuffer = req.rawBody;
      const result = this.verifySignature(rawBodyBuffer, signature, `channel:${channelId}`);
      if (!this.shouldProcessWebhook(result, `channel:${channelId}`, rawBodyBuffer?.length ?? 0)) {
        return;
      }
    }

    if (payload.object !== 'whatsapp_business_account') return;

    const channel = await this.channelRepository.findOne({
      where: { id: channelId, type: ChannelType.WHATSAPP_OFFICIAL },
    });

    if (!channel) {
      this.logger.warn('Channel-specific webhook: channel not found', { channelId });
      return;
    }

    try {
      await this.whatsAppService.processWebhook(payload, channelId);
    } catch (error: unknown) {
      this.logger.error('Error processing channel webhook', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }
}
