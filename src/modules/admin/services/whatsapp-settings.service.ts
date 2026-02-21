import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { WhatsappSettings, WhatsappProvider } from '../entities/whatsapp-settings.entity';
import { MessageLog, MessageStatus } from '../entities/message-log.entity';

@Injectable()
export class WhatsappSettingsService {
  private readonly logger = new Logger(WhatsappSettingsService.name);
  private readonly encKey: Buffer;

  constructor(
    @InjectRepository(WhatsappSettings)
    private readonly settingsRepo: Repository<WhatsappSettings>,

    @InjectRepository(MessageLog)
    private readonly messageLogRepo: Repository<MessageLog>,
  ) {
    const encKeySource = process.env.ENCRYPTION_KEY;

    // ✅ Security: Refuse to start with default key in production
    if (!encKeySource) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'FATAL: ENCRYPTION_KEY environment variable is not set. ' +
          'This is required for encrypting WhatsApp tokens. ' +
          'Set a strong random 32+ character value.',
        );
      }
      // Allow in dev/test with a warning
      this.logger.warn('⚠️  ENCRYPTION_KEY not set — using insecure default. Set it before production!');
    }

    this.encKey = scryptSync(
      encKeySource || 'rafeq-dev-only-key-not-for-production',
      'rafeq-salt-v1',
      32,
    );
  }

  async getSettings(): Promise<(Omit<WhatsappSettings, 'accessTokenEncrypted'> & { maskedToken: string }) | null> {
    const settings = await this.settingsRepo.findOne({ where: {} });

    if (!settings) {
      return null;
    }

    const { accessTokenEncrypted, ...rest } = settings;
    return {
      ...rest,
      maskedToken: accessTokenEncrypted ? this.maskToken(this.decrypt(accessTokenEncrypted)) : '****',
    };
  }

  async upsertSettings(data: {
    phoneNumber: string;
    provider: WhatsappProvider;
    accessToken: string;
    businessAccountId?: string;
    phoneNumberId?: string;
    webhookUrl?: string;
    webhookVerifyToken?: string;
    isActive?: boolean;
  }): Promise<WhatsappSettings> {
    let settings = await this.settingsRepo.findOne({ where: {} });

    const encrypted = this.encrypt(data.accessToken);

    if (settings) {
      Object.assign(settings, {
        phoneNumber: data.phoneNumber,
        provider: data.provider,
        accessTokenEncrypted: encrypted,
        businessAccountId: data.businessAccountId,
        phoneNumberId: data.phoneNumberId,
        webhookUrl: data.webhookUrl,
        webhookVerifyToken: data.webhookVerifyToken,
        isActive: data.isActive ?? settings.isActive,
      });
    } else {
      settings = this.settingsRepo.create({
        phoneNumber: data.phoneNumber,
        provider: data.provider,
        accessTokenEncrypted: encrypted,
        businessAccountId: data.businessAccountId,
        phoneNumberId: data.phoneNumberId,
        webhookUrl: data.webhookUrl,
        webhookVerifyToken: data.webhookVerifyToken,
        isActive: data.isActive ?? false,
      });
    }

    return this.settingsRepo.save(settings);
  }

  async toggleActive(isActive: boolean): Promise<void> {
    const settings = await this.settingsRepo.findOne({ where: {} });
    if (!settings) throw new NotFoundException('WhatsApp settings not configured');
    settings.isActive = isActive;
    await this.settingsRepo.save(settings);
  }

  async sendTestMessage(phoneNumber: string): Promise<{ success: boolean; message: string }> {
    const settings = await this.settingsRepo.findOne({ where: {} });

    if (!settings?.isActive) {
      throw new BadRequestException('WhatsApp is not active');
    }

    const token = this.decrypt(settings.accessTokenEncrypted);
    const result = await this.sendViaWhatsappApi(settings, token, phoneNumber, 'Test message from Rafeq Admin Panel 🎉');

    settings.lastTestSentAt = new Date();
    settings.connectionStatus = result.success ? 'connected' : 'error';
    await this.settingsRepo.save(settings);

    return result;
  }

  async sendMessage(
    recipientPhone: string,
    message: string,
    options?: {
      recipientUserId?: string;
      templateId?: string;
      triggerEvent?: string;
    },
  ): Promise<{ success: boolean; messageLogId: string | null }> {
    const settings = await this.settingsRepo.findOne({ where: {} });

    if (!settings?.isActive) {
      this.logger.warn('WhatsApp not active, skipping message send');
      return { success: false, messageLogId: null };
    }

    const log = await this.messageLogRepo.save(
      this.messageLogRepo.create({
        recipientUserId: options?.recipientUserId,
        recipientPhone,
        channel: 'whatsapp',
        templateId: options?.templateId,
        triggerEvent: options?.triggerEvent,
        content: message,
        status: MessageStatus.PENDING,
        attempts: 0,
      }),
    );

    try {
      const token = this.decrypt(settings.accessTokenEncrypted);
      const result = await this.sendViaWhatsappApi(settings, token, recipientPhone, message);

      await this.messageLogRepo.update(log.id, {
        status: result.success ? MessageStatus.SENT : MessageStatus.FAILED,
        attempts: 1,
        sentAt: result.success ? new Date() : undefined,
        responsePayload: result.response,
        errorMessage: result.error,
      });

      return { success: result.success, messageLogId: log.id };
    } catch (err) {
      await this.messageLogRepo.update(log.id, {
        status: MessageStatus.FAILED,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        attempts: 1,
      });
      return { success: false, messageLogId: log.id };
    }
  }

  private async sendViaWhatsappApi(
    settings: WhatsappSettings,
    token: string,
    to: string,
    message: string,
  ): Promise<{ success: boolean; response?: any; error?: string }> {
    try {
      if (settings.provider === WhatsappProvider.META) {
        const url = `https://graph.facebook.com/v18.0/${settings.phoneNumberId}/messages`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: message },
          }),
        });

        const data = await resp.json();
        if (!resp.ok) {
          return { success: false, response: data, error: data?.error?.message };
        }
        return { success: true, response: data };
      }

      // Twilio provider
      if (settings.provider === WhatsappProvider.TWILIO) {
        const [accountSid, authToken] = token.split(':');
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const body = new URLSearchParams({
          From: `whatsapp:${settings.phoneNumber}`,
          To: `whatsapp:${to}`,
          Body: message,
        });

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });

        const data = await resp.json();
        return { success: resp.ok, response: data };
      }

      return { success: false, error: 'Unsupported provider' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  // ─── Encryption ─────────────────────────────────────────────────────────────

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, dataHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encKey, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private maskToken(token: string): string {
    if (!token || token.length < 8) return '****';
    return `${token.slice(0, 4)}${'*'.repeat(token.length - 8)}${token.slice(-4)}`;
  }
}
