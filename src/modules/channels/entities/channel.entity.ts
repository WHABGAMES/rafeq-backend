/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channel Entity                             ║
 * ║                                                                                ║
 * ║  قنوات التواصل: واتساب رسمي، واتساب QR، انستقرام، ديسكورد                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../database/entities/base.entity';
import { Store } from '../../stores/entities/store.entity';

export enum ChannelType {
  WHATSAPP_OFFICIAL = 'whatsapp_official',
  WHATSAPP_UNOFFICIAL = 'whatsapp_unofficial',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
}

export enum ChannelStatus {
  PENDING = 'pending',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  BANNED = 'banned',
}

@Entity('channels')
@Index(['storeId', 'type'])
@Index(['status'])
export class Channel extends BaseEntity {
  @Column({
    name: 'store_id',
    type: 'uuid',
    comment: 'معرّف المتجر',
  })
  @Index()
  storeId: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @Column({
    type: 'enum',
    enum: ChannelType,
    comment: 'نوع القناة',
  })
  type: ChannelType;

  @Column({
    type: 'varchar',
    length: 255,
    comment: 'اسم القناة',
  })
  name: string;

  @Column({
    type: 'enum',
    enum: ChannelStatus,
    default: ChannelStatus.PENDING,
    comment: 'حالة القناة',
  })
  status: ChannelStatus;

  @Column({
    name: 'is_official',
    type: 'boolean',
    default: true,
    comment: 'هل القناة رسمية؟',
  })
  isOfficial: boolean;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 WhatsApp Official (Meta Business API)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'whatsapp_phone_number_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  whatsappPhoneNumberId?: string;

  @Column({
    name: 'whatsapp_business_account_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  whatsappBusinessAccountId?: string;

  @Column({
    name: 'whatsapp_access_token',
    type: 'text',
    nullable: true,
  })
  @Exclude()
  whatsappAccessToken?: string;

  @Column({
    name: 'whatsapp_phone_number',
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'رقم الهاتف المعروض',
  })
  whatsappPhoneNumber?: string;

  @Column({
    name: 'whatsapp_display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  whatsappDisplayName?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp Unofficial (Baileys/QR)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'session_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    unique: true,
    comment: 'معرّف جلسة Baileys',
  })
  sessionId?: string;

  @Column({
    name: 'session_data',
    type: 'text',
    nullable: true,
    comment: 'بيانات الجلسة المشفرة',
  })
  @Exclude()
  sessionData?: string;

  @Column({
    name: 'qr_code',
    type: 'text',
    nullable: true,
    comment: 'QR Code الحالي',
  })
  qrCode?: string;

  @Column({
    name: 'qr_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  qrExpiresAt?: Date;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📸 Instagram
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'instagram_user_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  instagramUserId?: string;

  @Column({
    name: 'instagram_username',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  instagramUsername?: string;

  @Column({
    name: 'instagram_access_token',
    type: 'text',
    nullable: true,
  })
  @Exclude()
  instagramAccessToken?: string;

  @Column({
    name: 'instagram_page_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Facebook Page ID المرتبطة',
  })
  instagramPageId?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 Discord
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'discord_bot_token',
    type: 'text',
    nullable: true,
  })
  @Exclude()
  discordBotToken?: string;

  @Column({
    name: 'discord_guild_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  discordGuildId?: string;

  @Column({
    name: 'discord_bot_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  discordBotId?: string;

  @Column({
    name: 'discord_bot_username',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  discordBotUsername?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Statistics
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'messages_sent',
    type: 'integer',
    default: 0,
  })
  messagesSent: number;

  @Column({
    name: 'messages_received',
    type: 'integer',
    default: 0,
  })
  messagesReceived: number;

  @Column({
    name: 'last_activity_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastActivityAt?: Date;

  @Column({
    name: 'connected_at',
    type: 'timestamptz',
    nullable: true,
  })
  connectedAt?: Date;

  @Column({
    name: 'disconnected_at',
    type: 'timestamptz',
    nullable: true,
  })
  disconnectedAt?: Date;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Error tracking
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'last_error',
    type: 'text',
    nullable: true,
  })
  lastError?: string;

  @Column({
    name: 'last_error_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastErrorAt?: Date;

  @Column({
    name: 'error_count',
    type: 'integer',
    default: 0,
  })
  errorCount: number;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Settings
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    type: 'jsonb',
    default: {},
    comment: 'إعدادات القناة',
  })
  settings: Record<string, unknown>;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Computed properties
  // ═══════════════════════════════════════════════════════════════════════════════

  get isConnected(): boolean {
    return this.status === ChannelStatus.CONNECTED;
  }

  get totalMessages(): number {
    return this.messagesSent + this.messagesReceived;
  }

  get displayIdentifier(): string | undefined {
    switch (this.type) {
      case ChannelType.WHATSAPP_OFFICIAL:
      case ChannelType.WHATSAPP_UNOFFICIAL:
        return this.whatsappPhoneNumber;
      case ChannelType.INSTAGRAM:
        return this.instagramUsername;
      case ChannelType.DISCORD:
        return this.discordBotUsername;
      default:
        return undefined;
    }
  }
}
