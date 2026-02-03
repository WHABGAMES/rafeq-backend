/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Service                           ║
 * ║                                                                                ║
 * ║  ✅ WhatsApp Official + WhatsApp QR + Instagram + Discord                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

import { Channel, ChannelType, ChannelStatus } from './entities/channel.entity';
// ✅ استيراد QRSessionResult واستخدامه بدلاً من تعريف محلي
import { WhatsAppBaileysService, QRSessionResult } from './whatsapp/whatsapp-baileys.service';

// ═══════════════════════════════════════════════════════════════════════════════
// DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConnectWhatsAppOfficialDto {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  verifyToken?: string;
}

export interface ConnectDiscordDto {
  botToken: string;
  guildId?: string;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    
    private readonly httpService: HttpService,
    
    private readonly whatsappBaileysService: WhatsAppBaileysService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 CRUD Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  async findAll(storeId: string): Promise<Channel[]> {
    return this.channelRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, storeId: string): Promise<Channel> {
    const channel = await this.channelRepository.findOne({
      where: { id, storeId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  async disconnect(id: string, storeId: string): Promise<void> {
    const channel = await this.findById(id, storeId);

    // إغلاق جلسة WhatsApp QR إن وجدت
    if (channel.type === ChannelType.WHATSAPP_QR) {
      await this.whatsappBaileysService.deleteSession(id);
    }

    await this.channelRepository.update(id, {
      status: ChannelStatus.DISCONNECTED,
      disconnectedAt: new Date(),
      whatsappAccessToken: undefined,
      sessionData: undefined,
      discordBotToken: undefined,
      instagramAccessToken: undefined,
    });

    this.logger.log(`Channel disconnected: ${id}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 WhatsApp Official (Meta Business API)
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectWhatsAppOfficial(
    storeId: string,
    dto: ConnectWhatsAppOfficialDto,
  ): Promise<Channel> {
    this.logger.log(`Connecting WhatsApp Official for store ${storeId}`);

    const phoneInfo = await this.verifyWhatsAppCredentials(dto);

    const existing = await this.channelRepository.findOne({
      where: {
        storeId,
        type: ChannelType.WHATSAPP_OFFICIAL,
        whatsappPhoneNumberId: dto.phoneNumberId,
      },
    });

    if (existing) {
      throw new BadRequestException('This WhatsApp number is already connected');
    }

    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.WHATSAPP_OFFICIAL,
      name: phoneInfo.display_phone_number || 'WhatsApp Business',
      status: ChannelStatus.CONNECTED,
      isOfficial: true,
      whatsappPhoneNumberId: dto.phoneNumberId,
      whatsappBusinessAccountId: dto.businessAccountId,
      whatsappAccessToken: dto.accessToken,
      whatsappPhoneNumber: phoneInfo.display_phone_number,
      whatsappDisplayName: phoneInfo.verified_name,
      connectedAt: new Date(),
      settings: {
        verifyToken: dto.verifyToken || this.generateVerifyToken(),
      },
    });

    const saved = await this.channelRepository.save(channel);
    this.logger.log(`WhatsApp Official connected: ${saved.id}`);
    return saved;
  }

  private async verifyWhatsAppCredentials(dto: ConnectWhatsAppOfficialDto): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v21.0/${dto.phoneNumberId}`,
          {
            headers: { Authorization: `Bearer ${dto.accessToken}` },
          },
        ),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to verify WhatsApp credentials', error.message);
      throw new BadRequestException('Invalid WhatsApp credentials');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp QR (Baileys)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ بدء جلسة WhatsApp QR جديدة
   * @returns QRSessionResult من WhatsApp Baileys Service
   */
  async initWhatsAppSession(storeId: string): Promise<QRSessionResult> {
    this.logger.log(`Initializing WhatsApp QR session for store ${storeId}`);

    // إنشاء قناة جديدة
    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.WHATSAPP_QR,
      name: 'WhatsApp (QR)',
      status: ChannelStatus.PENDING,
      isOfficial: false,
    });

    const savedChannel = await this.channelRepository.save(channel);

    try {
      // بدء جلسة Baileys
      const session = await this.whatsappBaileysService.initSession(savedChannel.id);

      // تحديث حالة القناة
      await this.channelRepository.update(savedChannel.id, {
        status: session.status === 'connected' 
          ? ChannelStatus.CONNECTED 
          : ChannelStatus.PENDING,
        sessionId: session.sessionId,
      });

      return session;
    } catch (error: any) {
      // حذف القناة إذا فشل
      await this.channelRepository.delete(savedChannel.id);
      
      this.logger.error('Failed to init WhatsApp session', error.message);
      throw new BadRequestException('Failed to initialize WhatsApp session');
    }
  }

  /**
   * ✅ الحصول على حالة جلسة WhatsApp QR
   * @returns QRSessionResult من WhatsApp Baileys Service
   */
  async getWhatsAppSessionStatus(sessionId: string): Promise<QRSessionResult> {
    const status = await this.whatsappBaileysService.getSessionStatus(sessionId);

    if (!status) {
      throw new NotFoundException('Session not found');
    }

    // تحديث حالة القناة في Database
    if (status.status === 'connected') {
      await this.channelRepository.update(sessionId, {
        status: ChannelStatus.CONNECTED,
        connectedAt: new Date(),
      });
    }

    return status;
  }

  async sendWhatsAppMessage(
    channelId: string,
    to: string,
    message: string,
  ): Promise<{ messageId: string }> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.type === ChannelType.WHATSAPP_QR) {
      // إرسال عبر Baileys
      return this.whatsappBaileysService.sendTextMessage(channelId, to, message);
    } else if (channel.type === ChannelType.WHATSAPP_OFFICIAL) {
      // إرسال عبر Meta API
      return this.sendWhatsAppOfficialMessage(channel, to, message);
    }

    throw new BadRequestException('Invalid channel type');
  }

  private async sendWhatsAppOfficialMessage(
    channel: Channel,
    to: string,
    message: string,
  ): Promise<{ messageId: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v21.0/${channel.whatsappPhoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: message },
          },
          {
            headers: {
              Authorization: `Bearer ${channel.whatsappAccessToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return { messageId: response.data.messages?.[0]?.id || '' };
    } catch (error: any) {
      this.logger.error('Failed to send WhatsApp Official message', error.message);
      throw new BadRequestException('Failed to send message');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📸 Instagram
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectInstagram(
    storeId: string,
    accessToken: string,
    userId: string,
    pageId: string,
  ): Promise<Channel> {
    this.logger.log(`Connecting Instagram for store ${storeId}`);

    const userInfo = await this.getInstagramUserInfo(accessToken, userId);

    const existing = await this.channelRepository.findOne({
      where: {
        storeId,
        type: ChannelType.INSTAGRAM,
        instagramUserId: userId,
      },
    });

    if (existing) {
      existing.instagramAccessToken = accessToken;
      existing.status = ChannelStatus.CONNECTED;
      return this.channelRepository.save(existing);
    }

    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.INSTAGRAM,
      name: userInfo.username || 'Instagram',
      status: ChannelStatus.CONNECTED,
      isOfficial: true,
      instagramUserId: userId,
      instagramUsername: userInfo.username,
      instagramAccessToken: accessToken,
      instagramPageId: pageId,
      connectedAt: new Date(),
    });

    const saved = await this.channelRepository.save(channel);
    this.logger.log(`Instagram connected: ${saved.id}`);
    return saved;
  }

  private async getInstagramUserInfo(accessToken: string, userId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v21.0/${userId}`,
          {
            params: {
              fields: 'username,name,profile_picture_url',
              access_token: accessToken,
            },
          },
        ),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to get Instagram user info', error.message);
      throw new BadRequestException('Failed to get Instagram account info');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 Discord
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectDiscord(storeId: string, dto: ConnectDiscordDto): Promise<Channel> {
    this.logger.log(`Connecting Discord for store ${storeId}`);

    const botInfo = await this.verifyDiscordBot(dto.botToken);

    const existing = await this.channelRepository.findOne({
      where: {
        storeId,
        type: ChannelType.DISCORD,
        discordBotId: botInfo.id,
      },
    });

    if (existing) {
      throw new BadRequestException('This Discord bot is already connected');
    }

    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.DISCORD,
      name: botInfo.username || 'Discord Bot',
      status: ChannelStatus.CONNECTED,
      isOfficial: true,
      discordBotToken: dto.botToken,
      discordGuildId: dto.guildId,
      discordBotId: botInfo.id,
      discordBotUsername: botInfo.username,
      connectedAt: new Date(),
    });

    const saved = await this.channelRepository.save(channel);
    this.logger.log(`Discord connected: ${saved.id}`);
    return saved;
  }

  private async verifyDiscordBot(botToken: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${botToken}` },
        }),
      );
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to verify Discord bot', error.message);
      throw new BadRequestException('Invalid Discord bot token');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateVerifyToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async updateStatus(id: string, status: ChannelStatus, error?: string): Promise<void> {
    const updateData: any = { status };

    if (error) {
      updateData.lastError = error;
      updateData.lastErrorAt = new Date();
    }

    if (status === ChannelStatus.CONNECTED) {
      updateData.connectedAt = new Date();
      updateData.errorCount = 0;
    }

    await this.channelRepository.update(id, updateData);
  }

  async incrementMessageCount(id: string, type: 'sent' | 'received'): Promise<void> {
    const field = type === 'sent' ? 'messagesSent' : 'messagesReceived';
    
    await this.channelRepository.increment({ id }, field, 1);
    await this.channelRepository.update(id, { lastActivityAt: new Date() });
  }
}
