/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Conversation Entity                        ║
 * ║                                                                                ║
 * ║  📌 الـ Conversation = محادثة مع عميل                                           ║
 * ║                                                                                ║
 * ║  تحتوي على:                                                                     ║
 * ║  - معلومات العميل                                                               ║
 * ║  - القناة المستخدمة                                                             ║
 * ║  - حالة المحادثة                                                                ║
 * ║  - الموظف المسؤول                                                               ║
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
import { Channel } from './channel.entity';
import { User } from './user.entity';

/**
 * 📌 حالة المحادثة
 */
export enum ConversationStatus {
  OPEN = 'open',           // مفتوحة
  PENDING = 'pending',     // في الانتظار
  ASSIGNED = 'assigned',   // معيّنة لموظف
  RESOLVED = 'resolved',   // تم الحل
  CLOSED = 'closed',       // مغلقة
}

/**
 * 📌 أولوية المحادثة
 */
export enum ConversationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * 📌 من يتحكم بالمحادثة حالياً
 */
export enum ConversationHandler {
  AI = 'ai',               // الذكاء الاصطناعي
  HUMAN = 'human',         // موظف بشري
  UNASSIGNED = 'unassigned', // غير معيّنة
}

@Entity('conversations')
export class Conversation extends BaseEntity {
  /**
   * 🏢 الـ Tenant
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_conversation_tenant')
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * 📱 القناة
   */
  @Column({ name: 'channel_id', type: 'uuid' })
  @Index('idx_conversation_channel')
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  /**
   * 👤 الموظف المسؤول (اختياري)
   */
  @Column({ name: 'assigned_to_id', type: 'uuid', nullable: true })
  @Index('idx_conversation_assigned')
  assignedToId?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo?: User;

  /**
   * 🔑 معرّف العميل في القناة
   * 
   * WhatsApp: رقم الهاتف
   * Instagram: Instagram ID
   * Discord: User ID
   */
  @Column({
    name: 'customer_external_id',
    type: 'varchar',
    length: 255,
  })
  @Index('idx_conversation_customer')
  customerExternalId: string;

  /**
   * 👤 Customer ID - معرف العميل في النظام
   */
  @Column({
    name: 'customer_id',
    type: 'uuid',
    nullable: true,
  })
  @Index('idx_conversation_customer_id')
  customerId?: string;

  /**
   * 👤 اسم العميل
   */
  @Column({
    name: 'customer_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  customerName?: string;

  /**
   * 📱 رقم هاتف العميل
   */
  @Column({
    name: 'customer_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  customerPhone?: string;

  /**
   * 📧 بريد العميل
   */
  @Column({
    name: 'customer_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  customerEmail?: string;

  /**
   * 📊 الحالة
   */
  @Column({
    type: 'enum',
    enum: ConversationStatus,
    default: ConversationStatus.OPEN,
  })
  @Index('idx_conversation_status')
  status: ConversationStatus;

  /**
   * ⚡ الأولوية
   */
  @Column({
    type: 'enum',
    enum: ConversationPriority,
    default: ConversationPriority.NORMAL,
  })
  priority: ConversationPriority;

  /**
   * 🤖 من يتحكم حالياً
   */
  @Column({
    type: 'enum',
    enum: ConversationHandler,
    default: ConversationHandler.AI,
  })
  handler: ConversationHandler;

  /**
   * 📌 الموضوع / العنوان
   */
  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  subject?: string;

  /**
   * 🏷️ التصنيفات
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: [],
  })
  tags: string[];

  /**
   * 📝 ملاحظات داخلية
   */
  @Column({
    type: 'text',
    nullable: true,
  })
  notes?: string;

  /**
   * 📊 عدد الرسائل
   */
  @Column({
    name: 'messages_count',
    type: 'integer',
    default: 0,
  })
  messagesCount: number;

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
   * 📅 تاريخ أول رد
   */
  @Column({
    name: 'first_response_at',
    type: 'timestamptz',
    nullable: true,
  })
  firstResponseAt?: Date;

  /**
   * 📅 تاريخ الحل
   */
  @Column({
    name: 'resolved_at',
    type: 'timestamptz',
    nullable: true,
  })
  resolvedAt?: Date;

  /**
   * 🤖 AI Context (سياق للذكاء الاصطناعي)
   * 
   * {
   *   "intent": "order_tracking",
   *   "orderId": "12345",
   *   "verified": true,
   *   "conversationHistory": [...]
   * }
   */
  @Column({
    name: 'ai_context',
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  aiContext: Record<string, unknown>;

  /**
   * 📝 بيانات إضافية
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  metadata: Record<string, unknown>;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 RELATIONS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  // @OneToMany(() => Message, message => message.conversation)
  // messages: Message[];
}
