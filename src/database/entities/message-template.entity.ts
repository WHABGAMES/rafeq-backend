/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Message Template Entity                    ║
 * ║  ✅ v2: إضافة triggerEvent + category varchar                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════════

export enum TemplateCategory {
  WELCOME = 'welcome',
  ORDER_CONFIRMATION = 'order_confirmation',
  SHIPPING_UPDATE = 'shipping_update',
  DELIVERY_CONFIRMATION = 'delivery_confirmation',
  ABANDONED_CART = 'abandoned_cart',
  PROMOTIONAL = 'promotional',
  REMINDER = 'reminder',
  FEEDBACK = 'feedback',
  SUPPORT = 'support',
  GENERAL = 'general',
  ORDER_NOTIFICATIONS = 'order_notifications',
  SHIPPING_NOTIFICATIONS = 'shipping_notifications',
  SALES_RECOVERY = 'sales_recovery',
  MARKETING = 'marketing',
  ENGAGEMENT = 'engagement',
  SERVICE = 'service',
}

export enum TemplateStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export enum TemplateChannel {
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
  EMAIL = 'email',
  INSTAGRAM = 'instagram',
  DISCORD = 'discord',
}

export enum TemplateLanguage {
  AR = 'ar',
  EN = 'en',
  AR_SA = 'ar_SA',
  EN_US = 'en_US',
}

export enum HeaderType {
  NONE = 'none',
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
}

export enum ButtonType {
  QUICK_REPLY = 'quick_reply',
  URL = 'url',
  PHONE = 'phone',
  COPY_CODE = 'copy_code',
}

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export interface TemplateHeader {
  type: HeaderType;
  text?: string;
  mediaUrl?: string;
  example?: string;
}

export interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  code?: string;
  example?: string;
}

export interface TemplateVariable {
  name: string;
  location: 'header' | 'body' | 'button';
  position: number;
  type: 'text' | 'number' | 'date' | 'currency' | 'url';
  example: string;
  defaultValue?: string;
}

export interface WhatsAppApproval {
  whatsappTemplateId?: string;
  whatsappTemplateName?: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt?: string;
  respondedAt?: string;
  rejectionReason?: string;
}

export interface TemplateStats {
  usageCount: number;
  lastUsedAt?: string;
  deliveryRate?: number;
  readRate?: number;
  replyRate?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════════════════════════

@Entity('message_templates')
@Index(['tenantId', 'channel', 'status'])
@Index(['tenantId', 'category'])
@Index(['tenantId', 'name'], { unique: true })
@Index(['tenantId', 'triggerEvent'])
export class MessageTemplate extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /** ✅ varchar بدل enum - يقبل أي تصنيف */
  @Column({ type: 'varchar', length: 100, default: 'general' })
  category: string;

  @Column({
    type: 'enum',
    enum: TemplateChannel,
    default: TemplateChannel.WHATSAPP,
  })
  channel: TemplateChannel;

  @Column({
    type: 'enum',
    enum: TemplateLanguage,
    default: TemplateLanguage.AR,
  })
  language: TemplateLanguage;

  /** ✅ varchar بدل enum - يقبل أي حالة بدون constraint */
  @Column({
    type: 'varchar',
    length: 50,
    default: 'draft',
  })
  status: string;

  /**
   * ✅ الحدث المرتبط بالقالب
   * مثل: order.created, order.shipped, abandoned.cart
   * يُستخدم لمطابقة webhook event → القالب المناسب
   */
  @Column({
    name: 'trigger_event',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  triggerEvent?: string;

  @Column({ type: 'jsonb', nullable: true })
  header?: TemplateHeader;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  footer?: string;

  @Column({ type: 'jsonb', nullable: true, default: [] })
  buttons: TemplateButton[];

  @Column({ type: 'jsonb', default: [] })
  variables: TemplateVariable[];

  @Column({ name: 'whatsapp_approval', type: 'jsonb', nullable: true })
  whatsAppApproval?: WhatsAppApproval;

  @Column({ type: 'jsonb', default: { usageCount: 0 } })
  stats: TemplateStats;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
