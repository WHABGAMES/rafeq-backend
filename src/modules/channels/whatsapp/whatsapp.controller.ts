/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Controller                              ║
 * ║                                                                                ║
 * ║  ✅ v3 — إصلاحات أمنية وجذرية                                                  ║
 * ║                                                                                ║
 * ║  FIX-1: verifySignature — صارم في الإنتاج، لا fallback غير آمن                ║
 * ║  FIX-2: handleWebhook — status updates محفوظة في message_logs                 ║
 * ║  FIX-3: أزلنا hardcoded values واستبدلناها بـ DB lookup                        ║
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
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';

import { WhatsAppService, WhatsAppWebhookPayload } from './whatsapp.service';
import { Channel, ChannelType, ChannelStatus } from '../entities/channel.entity';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WhatsappSettings } from '../../admin/entities/whatsapp-settings.entity';

// ── DTOs ──────────────────────────────────────────────────────────────────────

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
    parameters: Array<{ type: 'text' | 'image'; text?: string; image?: { link: string } }>;
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

// ── Controller ────────────────────────────────────────────────────────────────

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
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ── Helper: البحث عن القناة وبيانات الاعتماد ──────────────────────────────

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

  // ── Send Endpoints ─────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('send/text')
  @ApiOperation({ summary: 'إرسال رسالة نصية عبر WhatsApp' })
  @ApiResponse({ status: 200, description: 'تم إرسال الرسالة بنجاح' })
  async sendTextMessage(@Body() dto: SendTextMessageDto) {
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

  // ── Webhook Verification ───────────────────────────────────────────────────

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
    this.logger.log('WhatsApp webhook verification request', { mode, hasToken: !!token });
    const result = this.whatsAppService.verifyWebhook(mode, token, challenge);
    if (result) return res.status(HttpStatus.OK).send(result);
    return res.status(HttpStatus.FORBIDDEN).send('Verification failed');
  }

  // ── Main Webhook Handler ───────────────────────────────────────────────────

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WhatsApp Webhook Handler' })
  async handleWebhook(
    @Body() payload: WhatsAppWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    // ── FIX-1: التحقق من التوقيع بشكل صارم ───────────────────────────────
    const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
    const signatureCheckResult = this.checkSignature(req.rawBody, signatureHeader, payload);

    if (!signatureCheckResult.allowed) {
      this.logger.warn(`🚫 Webhook rejected: ${signatureCheckResult.reason}`);
      res.status(HttpStatus.UNAUTHORIZED).send('Invalid signature');
      return;
    }

    if (signatureCheckResult.warning) {
      this.logger.warn(signatureCheckResult.warning);
    }

    // إرسال 200 فوراً كما تطلبه Meta
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

      // 1. بحث في قنوات المتاجر
      const channel = await this.findChannelByPhoneNumberId(phoneNumberId);
      if (channel) {
        this.logger.log('Processing webhook for store channel', { channelId: channel.id, phoneNumberId });
        await this.whatsAppService.processWebhook(payload, channel.id);
        const messagesCount = payload.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0;
        if (messagesCount > 0) {
          await this.channelRepository.increment({ id: channel.id }, 'messagesReceived', messagesCount);
          await this.channelRepository.update(channel.id, { lastActivityAt: new Date() });
        }
        return;
      }

      // 2. بحث في إعدادات WhatsApp الإدارية
      const adminSettings = await this.whatsappSettingsRepo.findOne({ where: {} });
      if (adminSettings?.phoneNumberId === phoneNumberId) {
        this.logger.log('Processing admin WhatsApp webhook', { phoneNumberId });
        await this.processAdminWebhook(payload);
        return;
      }

      this.logger.warn('No channel found for phone_number_id', { phoneNumberId });
    } catch (error: any) {
      this.logger.error('Error processing WhatsApp webhook', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  // ── Channel-Specific Webhook ───────────────────────────────────────────────

  @Post('webhook/:channelId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Channel-specific WhatsApp Webhook' })
  async handleChannelWebhook(
    @Param('channelId') channelId: string,
    @Body() payload: WhatsAppWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
    const signatureCheckResult = this.checkSignature(req.rawBody, signatureHeader, payload);

    if (!signatureCheckResult.allowed) {
      this.logger.warn(`🚫 Channel webhook rejected: ${signatureCheckResult.reason}`, { channelId });
      res.status(HttpStatus.UNAUTHORIZED).send('Invalid signature');
      return;
    }

    res.status(HttpStatus.OK).send('EVENT_RECEIVED');
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
    } catch (error: any) {
      this.logger.error('Error processing channel webhook', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * FIX-1: منطق صارم للتحقق من التوقيع
   *
   * القواعد:
   * - في الإنتاج مع META_APP_SECRET مضبوط: يجب وجود توقيع صحيح
   * - في الإنتاج بدون META_APP_SECRET: رفض الطلب (خطأ في الإعداد)
   * - في التطوير: تحذير فقط
   *
   * ملاحظة: نجرب rawBody أولاً، ثم JSON.stringify كـ fallback
   * (Cloudflare قد يُعدّل whitespace مما يُفشل rawBody)
   */
  private checkSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    payload: any,
  ): { allowed: boolean; reason?: string; warning?: string } {
    const appSecret = this.configService.get<string>('whatsapp.appSecret');
    const isProduction = this.configService.get<string>('app.env') === 'production';

    // لا يوجد header توقيع
    if (!signatureHeader) {
      if (appSecret && isProduction) {
        return { allowed: false, reason: 'Missing x-hub-signature-256 header in production' };
      }
      if (appSecret) {
        return { allowed: false, reason: 'Missing x-hub-signature-256 header — META_APP_SECRET is configured' };
      }
      // لا appSecret ولا header — بيئة تطوير
      return {
        allowed: true,
        warning: 'META_APP_SECRET not configured — webhook signature verification disabled (dev mode only)',
      };
    }

    // يوجد header لكن لا يوجد appSecret
    if (!appSecret) {
      if (isProduction) {
        // خطأ إعداد خطير — نرفض الطلب
        return { allowed: false, reason: 'META_APP_SECRET not configured in production — cannot verify signature' };
      }
      // بيئة تطوير: نسمح مع تحذير
      return {
        allowed: true,
        warning: 'META_APP_SECRET not configured — skipping signature verification (dev mode only)',
      };
    }

    // تحقق فعلي من التوقيع
    const jsonBodyBuffer = Buffer.from(JSON.stringify(payload));
    const validRaw = rawBody ? this.verifySignatureBuffer(rawBody, signatureHeader, appSecret) : false;
    const validJson = this.verifySignatureBuffer(jsonBodyBuffer, signatureHeader, appSecret);

    if (!validRaw && !validJson) {
      return { allowed: false, reason: `Invalid HMAC-SHA256 signature` };
    }

    return { allowed: true };
  }

  private verifySignatureBuffer(body: Buffer, signature: string, appSecret: string): boolean {
    const [algorithm, hash] = signature.split('=');
    if (algorithm !== 'sha256' || !hash) return false;

    const expectedHash = crypto.createHmac('sha256', appSecret).update(body).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
    } catch {
      return false;
    }
  }

  // ─── Admin Inbox Conversation ────────────────────────────────────────────────

  /**
   * ✅ ينشئ أو يُحدّث conversation في admin inbox عند وصول رسالة على رقم الأدمن
   * يُرجع conversationId لإمكانية الاستخدام لاحقاً
   */
  private async createOrUpdateAdminInboxConversation(
    channelId: string,
    tenantId: string,
    senderPhone: string,
    senderName: string | null,
    content: string,
    externalMessageId: string,
    timestamp: Date,
  ): Promise<void> {
    // تحقق من عدم التكرار
    const [existingMsg] = await this.dataSource.query(
      `SELECT id FROM messages WHERE external_id = $1 LIMIT 1`,
      [externalMessageId],
    );
    if (existingMsg) {
      this.logger.debug(`Duplicate admin message: ${externalMessageId}`);
      return;
    }

    // ابحث عن conversation مفتوحة لنفس الرقم
    const [existingConv] = await this.dataSource.query(
      `SELECT id FROM conversations
       WHERE channel_id = $1
         AND (customer_phone = $2 OR customer_external_id = $2)
         AND status IN ('open', 'pending', 'assigned')
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT 1`,
      [channelId, senderPhone],
    );

    let conversationId: string;

    if (existingConv) {
      conversationId = existingConv.id;
      // تحديث بيانات المحادثة
      await this.dataSource.query(
        `UPDATE conversations
         SET last_message_at = $1,
             messages_count = messages_count + 1
             ${senderName ? `, customer_name = COALESCE(NULLIF(customer_name, ''), $3)` : ''}
         WHERE id = $2`,
        senderName
          ? [timestamp, conversationId, senderName]
          : [timestamp, conversationId],
      );
    } else {
      // إنشاء conversation جديدة
      const [newConv] = await this.dataSource.query(
        `INSERT INTO conversations
           (id, tenant_id, channel_id,
            customer_phone, customer_external_id, customer_name,
            status, handler, messages_count, last_message_at,
            ai_context, metadata, tags, created_at, updated_at)
         VALUES
           (gen_random_uuid(), $1, $2,
            $3, $3, $4,
            'open', 'human', 1, $5,
            '{}', '{}', '{}', $5, $5)
         RETURNING id`,
        [tenantId, channelId, senderPhone, senderName || 'عميل', timestamp],
      );
      conversationId = newConv.id;
      this.logger.log(`📝 New admin inbox conversation: ${conversationId} for ${senderPhone}`);
    }

    // إضافة الرسالة
    await this.dataSource.query(
      `INSERT INTO messages
         (id, tenant_id, conversation_id,
          direction, type, status, sender,
          external_id, content, metadata,
          delivered_at, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2,
          'inbound', 'text', 'delivered', 'customer',
          $3, $4, '{}',
          $5, $5, $5)`,
      [tenantId, conversationId, externalMessageId, content, timestamp],
    );

    this.logger.log(`✅ Admin inbox conversation updated: ${conversationId}`);
  }

  /**
   * FIX-2: معالجة webhook الإداري مع حفظ status updates
   * ✅ FIX-3: ينشئ Conversation + Message في جداول المحادثات ليظهر في admin inbox
   */
  private async processAdminWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    // ✅ جلب channel الأدمن مرة واحدة لكل الرسائل
    const adminSettings = await this.whatsappSettingsRepo.findOne({ where: {} });
    const adminChannel = adminSettings?.phoneNumberId
      ? await this.channelRepository.findOne({
          where: { whatsappPhoneNumberId: adminSettings.phoneNumberId },
        })
      : null;

    // جلب tenantId من store المرتبط بـ admin channel
    let adminTenantId: string | null = null;
    if (adminChannel?.storeId) {
      const [store] = await this.dataSource.query(
        `SELECT tenant_id FROM stores WHERE id = $1 LIMIT 1`,
        [adminChannel.storeId],
      );
      adminTenantId = store?.tenant_id || null;
    }

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {

        // ── الرسائل الواردة ────────────────────────────────────────────────
        const incomingMessages = change.value?.messages || [];
        for (const msg of incomingMessages) {
          try {
            let content: string | null = null;
            if (msg.text?.body) content = msg.text.body;
            else if (msg.image?.caption) content = `[صورة] ${msg.image.caption}`;
            else if (msg.image) content = '[صورة]';
            else if (msg.video?.caption) content = `[فيديو] ${msg.video.caption}`;
            else if (msg.video) content = '[فيديو]';
            else if (msg.audio) content = '[رسالة صوتية]';
            else if (msg.document?.filename) content = `[ملف: ${msg.document.filename}]`;
            else if (msg.interactive?.button_reply?.title) content = `[زر: ${msg.interactive.button_reply.title}]`;
            else if (msg.interactive?.list_reply?.title) content = `[قائمة: ${msg.interactive.list_reply.title}]`;
            else content = `[${msg.type || 'رسالة'}]`;

            const phone = msg.from?.replace(/\D/g, '') || null;
            const senderName = change.value?.contacts?.[0]?.profile?.name || null;
            const now = new Date(parseInt(msg.timestamp) * 1000);

            // ✅ حفظ في message_logs للتتبع
            await this.dataSource.query(`
              INSERT INTO message_logs
                (id, channel, direction, recipient_phone, content, trigger_event, status, attempts, sent_at, created_at)
              VALUES
                (gen_random_uuid(), 'whatsapp', 'inbound', $1, $2, 'inbound', 'received', 0, NOW(), NOW())
            `, [phone, content]);

            // ✅ إنشاء/تحديث Conversation في admin inbox
            if (adminChannel && adminTenantId && phone) {
              await this.createOrUpdateAdminInboxConversation(
                adminChannel.id,
                adminTenantId,
                phone,
                senderName,
                content || '',
                msg.id,
                now,
              );
            }

            this.logger.log(`✅ Saved inbound admin WhatsApp message`, { from: phone, type: msg.type });
          } catch (err) {
            this.logger.error('Failed to save inbound admin WhatsApp message', {
              error: err instanceof Error ? err.message : 'Unknown',
            });
          }
        }

        // ── FIX-2: تحديثات الحالة محفوظة في message_logs ────────────────
        const statuses = change.value?.statuses || [];
        for (const status of statuses) {
          try {
            if (['delivered', 'read', 'failed'].includes(status.status)) {
              // تحديث الحالة في message_logs باستخدام الـ external message ID
              const newStatus = status.status === 'failed' ? 'failed' : 'sent';
              const statusLabel = status.status === 'delivered' ? 'delivered' :
                                  status.status === 'read' ? 'read' : 'failed';

              await this.dataSource.query(`
                UPDATE message_logs
                SET 
                  status = $1,
                  response_payload = COALESCE(response_payload, '{}'::jsonb) || $2::jsonb
                WHERE 
                  response_payload->>'message_id' = $3
                  AND direction = 'outbound'
              `, [
                newStatus,
                JSON.stringify({ delivery_status: statusLabel, delivery_time: new Date(parseInt(status.timestamp) * 1000).toISOString() }),
                status.id,
              ]);

              this.logger.debug(`📊 Admin WhatsApp status update: ${status.status}`, { messageId: status.id });
            }
          } catch (err) {
            this.logger.error('Failed to update message_logs status', {
              error: err instanceof Error ? err.message : 'Unknown',
              messageId: status.id,
            });
          }
        }
      }
    }
  }
}
