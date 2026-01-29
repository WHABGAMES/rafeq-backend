/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Message Entity                             ║
 * ║                                                                                ║
 * ║  📌 الـ Message = رسالة واحدة في محادثة                                          ║
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
import { Conversation } from './conversation.entity';

/**
 * 📌 اتجاه الرسالة
 */
export enum MessageDirection {
  INBOUND = 'inbound',     // من العميل
  OUTBOUND = 'outbound',   // إلى العميل
}

/**
 * 📌 نوع الرسالة
 */
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  LOCATION = 'location',
  CONTACT = 'contact',
  STICKER = 'sticker',
  TEMPLATE = 'template',    // WhatsApp template
  INTERACTIVE = 'interactive', // Buttons, Lists
  SYSTEM = 'system',        // System message
}

/**
 * 📌 حالة الرسالة
 */
export enum MessageStatus {
  PENDING = 'pending',     // في الانتظار
  SENT = 'sent',           // تم الإرسال
  DELIVERED = 'delivered', // تم التوصيل
  READ = 'read',           // تمت القراءة
  FAILED = 'failed',       // فشل الإرسال
}

/**
 * 📌 مصدر الرسالة الصادرة
 */
export enum MessageSender {
  CUSTOMER = 'customer',   // العميل
  AGENT = 'agent',         // موظف
  AI = 'ai',               // الذكاء الاصطناعي
  SYSTEM = 'system',       // النظام
  CAMPAIGN = 'campaign',   // حملة تسويقية
}

@Entity('messages')
export class Message extends BaseEntity {
  /**
   * 🏢 الـ Tenant
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_message_tenant')
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * 💬 المحادثة
   */
  @Column({ name: 'conversation_id', type: 'uuid' })
  @Index('idx_message_conversation')
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  /**
   * ➡️ الاتجاه
   */
  @Column({
    type: 'enum',
    enum: MessageDirection,
  })
  @Index('idx_message_direction')
  direction: MessageDirection;

  /**
   * 📝 نوع الرسالة
   */
  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT,
  })
  type: MessageType;

  /**
   * 📊 الحالة
   */
  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.PENDING,
  })
  @Index('idx_message_status')
  status: MessageStatus;

  /**
   * 👤 المرسل
   */
  @Column({
    type: 'enum',
    enum: MessageSender,
    default: MessageSender.CUSTOMER,
  })
  sender: MessageSender;

  /**
   * 🔑 معرّف الرسالة في القناة الخارجية
   */
  @Column({
    name: 'external_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @Index('idx_message_external_id')
  externalId?: string;

  /**
   * 📝 محتوى الرسالة (نص)
   */
  @Column({
    type: 'text',
    nullable: true,
  })
  content?: string;

  /**
   * 📎 الوسائط (صور، فيديو، ملفات)
   * 
   * {
   *   "url": "https://...",
   *   "mimeType": "image/jpeg",
   *   "filename": "photo.jpg",
   *   "size": 102400
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  media?: {
    url: string;
    mimeType?: string;
    filename?: string;
    size?: number;
    caption?: string;
  };

  /**
   * 📍 الموقع (إذا كان نوع الرسالة location)
   */
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  /**
   * 🎯 Interactive (أزرار، قوائم)
   */
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  interactive?: {
    type: 'button' | 'list' | 'product';
    header?: string;
    body?: string;
    footer?: string;
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };

  /**
   * 📋 Template (WhatsApp templates)
   */
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  template?: {
    name: string;
    language: string;
    components?: Array<{
      type: string;
      parameters?: Array<{ type: string; text?: string }>;
    }>;
  };

  /**
   * 🤖 AI Metadata
   * 
   * {
   *   "intent": "order_tracking",
   *   "confidence": 0.95,
   *   "toolsCalled": ["get_order_status"],
   *   "processingTime": 1500
   * }
   */
  @Column({
    name: 'ai_metadata',
    type: 'jsonb',
    nullable: true,
  })
  aiMetadata?: Record<string, unknown>;

  /**
   * ❌ سبب الفشل
   */
  @Column({
    name: 'error_message',
    type: 'text',
    nullable: true,
  })
  errorMessage?: string;

  /**
   * 📅 تاريخ الإرسال
   */
  @Column({
    name: 'sent_at',
    type: 'timestamptz',
    nullable: true,
  })
  sentAt?: Date;

  /**
   * 📅 تاريخ التوصيل
   */
  @Column({
    name: 'delivered_at',
    type: 'timestamptz',
    nullable: true,
  })
  deliveredAt?: Date;

  /**
   * 📅 تاريخ القراءة
   */
  @Column({
    name: 'read_at',
    type: 'timestamptz',
    nullable: true,
  })
  readAt?: Date;

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
