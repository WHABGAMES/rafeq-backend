/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Service                           ║
 * ║                                                                                ║
 * ║  ✅ إدارة قنوات التواصل: واتساب، انستقرام، ديسكورد                            ║
 * ║  ✅ متكامل مع WhatsAppBaileysService                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

import { Channel, ChannelType, ChannelStatus } from './entities/channel.entity';
import { WhatsAppBaileysService } from './whatsapp-baileys.service';

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

export interface WhatsAppQRSession {
  sessionId: string;
  qrCode: string;
  expiresAt: Date;
  status: 'pending' | 'scanning' | 'connected' | 'expired';
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    
    @Inject(forwardRef(() => WhatsAppBaileysService))
    private readonly baileysService: WhatsAppBaileysService,
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

    switch (channel.type) {
      case ChannelType.WHATSAPP_UNOFFICIAL:
        await this.baileysService.disconnectSession(channel.id);
        break;
      case ChannelType.DISCORD:
        this.logger.log(`Discord bot disconnected: ${channel.discordBotId}`);
        break;
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

    // التحقق من صحة الـ credentials مع Meta API
    const phoneInfo = await this.verifyWhatsAppCredentials(dto);

    // التحقق من عدم وجود قناة مكررة
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
          `https://graph.facebook.com/v18.0/${dto.phoneNumberId}`,
          {
            headers: {
              Authorization: `Bearer ${dto.accessToken}`,
            },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to verify WhatsApp credentials', error.message);
      throw new BadRequestException('Invalid WhatsApp credentials. Please check your Phone Number ID and Access Token.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Unofficial (Baileys/QR)
  // ═══════════════════════════════════════════════════════════════════════════════

  async initWhatsAppSession(storeId: string): Promise<WhatsAppQRSession> {
    this.logger.log(`Initializing WhatsApp QR for store ${storeId}`);

    // البحث عن قناة موجودة أو إنشاء جديدة
    let channel = await this.channelRepository.findOne({
      where: {
        storeId,
        type: ChannelType.WHATSAPP_UNOFFICIAL,
      },
    });

    if (!channel) {
      channel = this.channelRepository.create({
        storeId,
        type: ChannelType.WHATSAPP_UNOFFICIAL,
        name: 'WhatsApp (QR)',
        status: ChannelStatus.PENDING,
        isOfficial: false,
      });
      channel = await this.channelRepository.save(channel);
    }

    // بدء جلسة Baileys
    const result = await this.baileysService.initSession(channel.id);
    
    return {
      sessionId: result.sessionId,
      qrCode: result.qrCode || '',
      expiresAt: new Date(Date.now() + 60000),
      status: result.status as 'pending' | 'scanning' | 'connected' | 'expired',
    };
  }

  async getWhatsAppSessionStatus(sessionId: string): Promise<WhatsAppQRSession> {
    const result = await this.baileysService.getSessionStatus(sessionId);

    return {
      sessionId,
      qrCode: result.qrCode || '',
      expiresAt: result.expiresAt || new Date(),
      status: result.status as 'pending' | 'scanning' | 'connected' | 'expired',
    };
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

    // جلب معلومات الحساب من Instagram Graph API
    const userInfo = await this.getInstagramUserInfo(accessToken, userId);

    // التحقق من عدم وجود قناة مكررة
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
          `https://graph.facebook.com/v18.0/${userId}`,
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
      throw new BadRequestException('Failed to get Instagram account info.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 Discord
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectDiscord(storeId: string, dto: ConnectDiscordDto): Promise<Channel> {
    this.logger.log(`Connecting Discord for store ${storeId}`);

    // التحقق من صحة الـ Bot Token مع Discord API
    const botInfo = await this.verifyDiscordBot(dto.botToken);

    // التحقق من عدم وجود قناة مكررة
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
          headers: {
            Authorization: `Bot ${botToken}`,
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to verify Discord bot', error.message);
      throw new BadRequestException('Invalid Discord bot token.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateVerifyToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async updateStatus(id: string, status: ChannelStatus, error?: string): Promise<void> {
    const updateData: Partial<Channel> = { status };

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
