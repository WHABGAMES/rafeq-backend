/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channel Entity                             ║
 * ║                                                                                ║
 * ║  📌 الـ Channel = قناة تواصل (WhatsApp, Instagram, Discord)                     ║
 * ║                                                                                ║
 * ║  كل Tenant يمكن أن يربط عدة قنوات                                               ║
 * ║  كل قناة لها إعدادات وcredentials خاصة                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

/**
 * 📌 نوع القناة
 */
export enum ChannelType {
  WHATSAPP = 'whatsapp',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
}

/**
 * 📌 حالة القناة
 */
export enum ChannelStatus {
  ACTIVE = 'active',           // متصل ويعمل
  INACTIVE = 'inactive',       // غير نشط
  DISCONNECTED = 'disconnected', // تم قطع الاتصال
  PENDING = 'pending',         // في انتظار التفعيل
  ERROR = 'error',             // خطأ
}

@Entity('channels')
export class Channel extends BaseEntity {
  /**
   * 🏢 الـ Tenant
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_channel_tenant')
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * 📱 نوع القناة
   */
  @Column({
    type: 'enum',
    enum: ChannelType,
  })
  @Index('idx_channel_type')
  type: ChannelType;

  /**
   * 🏷️ اسم القناة (للعرض)
   */
  @Column({
    type: 'varchar',
    length: 255,
  })
  name: string;

  /**
   * 📊 الحالة
   */
  @Column({
    type: 'enum',
    enum: ChannelStatus,
    default: ChannelStatus.PENDING,
  })
  @Index('idx_channel_status')
  status: ChannelStatus;

  /**
   * 🔑 معرّف القناة في المنصة الخارجية
   * 
   * WhatsApp: Phone Number ID
   * Instagram: Instagram Business Account ID
   * Discord: Guild ID
   */
  @Column({
    name: 'external_id',
    type: 'varchar',
    length: 255,
  })
  @Index('idx_channel_external_id')
  externalId: string;

  /**
   * 📱 رقم الهاتف / اسم المستخدم
   */
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  identifier?: string;

  /**
   * 🔐 Credentials (مشفرة)
   * 
   * WhatsApp:
   * {
   *   "accessToken": "...",
   *   "phoneNumberId": "...",
   *   "businessAccountId": "..."
   * }
   * 
   * Instagram:
   * {
   *   "accessToken": "...",
   *   "pageId": "..."
   * }
   * 
   * Discord:
   * {
   *   "botToken": "...",
   *   "guildId": "..."
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    select: false,
  })
  credentials?: Record<string, string>;

  /**
   * ⚙️ إعدادات القناة
   * 
   * {
   *   "welcomeMessage": "مرحباً!",
   *   "aiEnabled": true,
   *   "autoReply": true,
   *   "workingHours": { "start": "09:00", "end": "21:00" }
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  settings: Record<string, unknown>;

  /**
   * 📊 إحصائيات القناة
   * 
   * {
   *   "messagesReceived": 5000,
   *   "messagesSent": 4500,
   *   "conversationsCount": 800
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  stats: Record<string, number>;

  /**
   * 📅 تاريخ آخر رسالة
   */
  @Column({
    name: 'last_message_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastMessageAt?: Date;

  /**
   * 📝 بيانات إضافية
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  metadata: Record<string, unknown>;
}
