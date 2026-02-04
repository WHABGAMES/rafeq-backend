/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Service                           ║
 * ║                                                                                ║
 * ║  ✅ WhatsApp Official + QR + Phone Code + Instagram + Discord                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

import { Channel, ChannelType, ChannelStatus } from './entities/channel.entity';
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
  // 📋 CRUD
  // ═══════════════════════════════════════════════════════════════════════════════

  async findAll(storeId: string): Promise<Channel[]> {
    return this.channelRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, storeId: string): Promise<Channel> {
    const channel = await this.channelRepository.findOne({ where: { id, storeId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async disconnect(id: string, storeId: string): Promise<void> {
    const channel = await this.findById(id, storeId);
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
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 WhatsApp Official (Meta Business API)
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectWhatsAppOfficial(storeId: string, dto: ConnectWhatsAppOfficialDto): Promise<Channel> {
    this.logger.log(`Connecting WhatsApp Official for store ${storeId}`);
    const phoneInfo = await this.verifyWhatsAppCredentials(dto);

    const existing = await this.channelRepository.findOne({
      where: { storeId, type: ChannelType.WHATSAPP_OFFICIAL, whatsappPhoneNumberId: dto.phoneNumberId },
    });
    if (existing) throw new BadRequestException('This WhatsApp number is already connected');

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
      settings: { verifyToken: dto.verifyToken || this.generateVerifyToken() },
    });

    return this.channelRepository.save(channel);
  }

  private async verifyWhatsAppCredentials(dto: ConnectWhatsAppOfficialDto): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`https://graph.facebook.com/v21.0/${dto.phoneNumberId}`, {
          headers: { Authorization: `Bearer ${dto.accessToken}` },
        }),
      );
      return response.data;
    } catch (error: any) {
      throw new BadRequestException('Invalid WhatsApp credentials');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp QR (Baileys)
  // ═══════════════════════════════════════════════════════════════════════════════

  async initWhatsAppSession(storeId: string): Promise<QRSessionResult> {
    this.logger.log(`[QR] Init for store ${storeId}`);
    return this.createWhatsAppQRChannel(storeId, 'qr');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Phone Code (Baileys)
  // ═══════════════════════════════════════════════════════════════════════════════

  async initWhatsAppSessionWithPhoneCode(
    storeId: string,
    phoneNumber: string,
  ): Promise<QRSessionResult> {
    this.logger.log(`[Phone] Init for store ${storeId}, phone: ${phoneNumber}`);
    return this.createWhatsAppQRChannel(storeId, 'phone_code', phoneNumber);
  }

  /**
   * ✅ إنشاء قناة WhatsApp QR/Phone مشتركة
   */
  private async createWhatsAppQRChannel(
    storeId: string,
    method: 'qr' | 'phone_code',
    phoneNumber?: string,
  ): Promise<QRSessionResult> {
    const channel = this.channelRepository.create({
      storeId,
      type: ChannelType.WHATSAPP_QR,
      name: method === 'phone_code' ? `WhatsApp (${phoneNumber})` : 'WhatsApp (QR)',
      status: ChannelStatus.PENDING,
      isOfficial: false,
    });

    const savedChannel = await this.channelRepository.save(channel);

    try {
      let session: QRSessionResult;

      if (method === 'phone_code' && phoneNumber) {
        session = await this.whatsappBaileysService.initSessionWithPhoneCode(
          savedChannel.id,
          phoneNumber,
        );
      } else {
        session = await this.whatsappBaileysService.initSession(savedChannel.id);
      }

      await this.channelRepository.update(savedChannel.id, {
        status: session.status === 'connected' ? ChannelStatus.CONNECTED : ChannelStatus.PENDING,
        sessionId: session.sessionId,
        whatsappPhoneNumber: phoneNumber,
      });

      return session;
    } catch (error: any) {
      await this.channelRepository.delete(savedChannel.id);
      this.logger.error('Failed to init WhatsApp session', error.message);
      throw new BadRequestException(error.message || 'Failed to initialize WhatsApp session');
    }
  }

  async getWhatsAppSessionStatus(sessionId: string): Promise<QRSessionResult> {
    const status = await this.whatsappBaileysService.getSessionStatus(sessionId);
    if (!status) throw new NotFoundException('Session not found');

    if (status.status === 'connected') {
      await this.channelRepository.update(sessionId, {
        status: ChannelStatus.CONNECTED,
        connectedAt: new Date(),
        whatsappPhoneNumber: status.phoneNumber,
      });
    }

    return status;
  }

  async sendWhatsAppMessage(channelId: string, to: string, message: string): Promise<{ messageId: string }> {
    const channel = await this.channelRepository.findOne({ where: { id: channelId } });
    if (!channel) throw new NotFoundException('Channel not found');

    if (channel.type === ChannelType.WHATSAPP_QR) {
      return this.whatsappBaileysService.sendTextMessage(channelId, to, message);
    } else if (channel.type === ChannelType.WHATSAPP_OFFICIAL) {
      return this.sendWhatsAppOfficialMessage(channel, to, message);
    }

    throw new BadRequestException('Invalid channel type');
  }

  private async sendWhatsAppOfficialMessage(channel: Channel, to: string, message: string): Promise<{ messageId: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v21.0/${channel.whatsappPhoneNumberId}/messages`,
          { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
          { headers: { Authorization: `Bearer ${channel.whatsappAccessToken}`, 'Content-Type': 'application/json' } },
        ),
      );
      return { messageId: response.data.messages?.[0]?.id || '' };
    } catch (error: any) {
      throw new BadRequestException('Failed to send message');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📸 Instagram
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectInstagram(storeId: string, accessToken: string, userId: string, pageId: string): Promise<Channel> {
    const userInfo = await this.getInstagramUserInfo(accessToken, userId);
    const existing = await this.channelRepository.findOne({
      where: { storeId, type: ChannelType.INSTAGRAM, instagramUserId: userId },
    });

    if (existing) {
      existing.instagramAccessToken = accessToken;
      existing.status = ChannelStatus.CONNECTED;
      return this.channelRepository.save(existing);
    }

    const channel = this.channelRepository.create({
      storeId, type: ChannelType.INSTAGRAM,
      name: userInfo.username || 'Instagram',
      status: ChannelStatus.CONNECTED, isOfficial: true,
      instagramUserId: userId, instagramUsername: userInfo.username,
      instagramAccessToken: accessToken, instagramPageId: pageId,
      connectedAt: new Date(),
    });
    return this.channelRepository.save(channel);
  }

  private async getInstagramUserInfo(accessToken: string, userId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`https://graph.facebook.com/v21.0/${userId}`, {
          params: { fields: 'username,name,profile_picture_url', access_token: accessToken },
        }),
      );
      return response.data;
    } catch {
      throw new BadRequestException('Failed to get Instagram account info');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 Discord
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectDiscord(storeId: string, dto: ConnectDiscordDto): Promise<Channel> {
    const botInfo = await this.verifyDiscordBot(dto.botToken);
    const existing = await this.channelRepository.findOne({
      where: { storeId, type: ChannelType.DISCORD, discordBotId: botInfo.id },
    });
    if (existing) throw new BadRequestException('This Discord bot is already connected');

    const channel = this.channelRepository.create({
      storeId, type: ChannelType.DISCORD,
      name: botInfo.username || 'Discord Bot',
      status: ChannelStatus.CONNECTED, isOfficial: true,
      discordBotToken: dto.botToken, discordGuildId: dto.guildId,
      discordBotId: botInfo.id, discordBotUsername: botInfo.username,
      connectedAt: new Date(),
    });
    return this.channelRepository.save(channel);
  }

  private async verifyDiscordBot(botToken: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${botToken}` },
        }),
      );
      return response.data;
    } catch {
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
    if (error) { updateData.lastError = error; updateData.lastErrorAt = new Date(); }
    if (status === ChannelStatus.CONNECTED) { updateData.connectedAt = new Date(); updateData.errorCount = 0; }
    await this.channelRepository.update(id, updateData);
  }

  async incrementMessageCount(id: string, type: 'sent' | 'received'): Promise<void> {
    const field = type === 'sent' ? 'messagesSent' : 'messagesReceived';
    await this.channelRepository.increment({ id }, field, 1);
    await this.channelRepository.update(id, { lastActivityAt: new Date() });
  }
}
