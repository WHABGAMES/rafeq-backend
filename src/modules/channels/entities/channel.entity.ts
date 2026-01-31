/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channel Entity                             ║
 * ║                                                                                ║
 * ║  ✅ يدعم WhatsApp Official + WhatsApp QR + Instagram + Discord                 ║
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
  WHATSAPP_QR = 'whatsapp_qr',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
  TELEGRAM = 'telegram',
  SMS = 'sms',
  EMAIL = 'email',
}

export enum ChannelStatus {
  PENDING = 'pending',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  EXPIRED = 'expired',
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
  store?: Store;

  @Column({
    type: 'varchar',
    length: 255,
    comment: 'اسم القناة',
  })
  name: string;

  @Column({
    type: 'enum',
    enum: ChannelType,
    comment: 'نوع القناة',
  })
  type: ChannelType;

  @Column({
    type: 'enum',
    enum: ChannelStatus,
    default: ChannelStatus.PENDING,
    comment: 'حالة الاتصال',
  })
  status: ChannelStatus;

  @Column({
    name: 'is_official',
    type: 'boolean',
    default: false,
    comment: 'هل هي قناة رسمية (API)',
  })
  isOfficial: boolean;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💬 WhatsApp Official Fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'whatsapp_phone_number_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Phone Number ID من Meta',
  })
  whatsappPhoneNumberId?: string;

  @Column({
    name: 'whatsapp_business_account_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Business Account ID من Meta',
  })
  whatsappBusinessAccountId?: string;

  @Column({
    name: 'whatsapp_access_token',
    type: 'text',
    nullable: true,
    comment: 'Access Token للـ WhatsApp API',
  })
  @Exclude()
  whatsappAccessToken?: string;

  @Column({
    name: 'whatsapp_phone_number',
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'رقم الهاتف',
  })
  whatsappPhoneNumber?: string;

  @Column({
    name: 'whatsapp_display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'الاسم المعروض',
  })
  whatsappDisplayName?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WhatsApp QR (Baileys) Fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'session_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'معرّف جلسة Baileys',
  })
  sessionId?: string;

  @Column({
    name: 'session_data',
    type: 'text',
    nullable: true,
    comment: 'بيانات الجلسة (مشفرة)',
  })
  @Exclude()
  sessionData?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📸 Instagram Fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'instagram_user_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Instagram User ID',
  })
  instagramUserId?: string;

  @Column({
    name: 'instagram_username',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Instagram Username',
  })
  instagramUsername?: string;

  @Column({
    name: 'instagram_access_token',
    type: 'text',
    nullable: true,
    comment: 'Instagram Access Token',
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
  // 🎮 Discord Fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'discord_bot_token',
    type: 'text',
    nullable: true,
    comment: 'Discord Bot Token',
  })
  @Exclude()
  discordBotToken?: string;

  @Column({
    name: 'discord_guild_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Discord Guild/Server ID',
  })
  discordGuildId?: string;

  @Column({
    name: 'discord_bot_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Discord Bot ID',
  })
  discordBotId?: string;

  @Column({
    name: 'discord_bot_username',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Discord Bot Username',
  })
  discordBotUsername?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Common Fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    type: 'jsonb',
    default: {},
    comment: 'إعدادات القناة',
  })
  settings: Record<string, unknown>;

  @Column({
    name: 'connected_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ الاتصال',
  })
  connectedAt?: Date;

  @Column({
    name: 'disconnected_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ قطع الاتصال',
  })
  disconnectedAt?: Date;

  @Column({
    name: 'last_activity_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'آخر نشاط',
  })
  lastActivityAt?: Date;

  @Column({
    name: 'messages_sent',
    type: 'integer',
    default: 0,
    comment: 'عدد الرسائل المُرسلة',
  })
  messagesSent: number;

  @Column({
    name: 'messages_received',
    type: 'integer',
    default: 0,
    comment: 'عدد الرسائل المُستلمة',
  })
  messagesReceived: number;

  @Column({
    name: 'last_error',
    type: 'text',
    nullable: true,
    comment: 'آخر خطأ',
  })
  lastError?: string;

  @Column({
    name: 'last_error_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ آخر خطأ',
  })
  lastErrorAt?: Date;

  @Column({
    name: 'error_count',
    type: 'integer',
    default: 0,
    comment: 'عدد الأخطاء المتتالية',
  })
  errorCount: number;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Computed Properties
  // ═══════════════════════════════════════════════════════════════════════════════

  get isConnected(): boolean {
    return this.status === ChannelStatus.CONNECTED;
  }

  get isWhatsApp(): boolean {
    return this.type === ChannelType.WHATSAPP_OFFICIAL || this.type === ChannelType.WHATSAPP_QR;
  }

  get displayPhoneNumber(): string | undefined {
    return this.whatsappPhoneNumber;
  }
}
