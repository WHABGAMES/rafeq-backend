import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Admin Notification Template Entity (v3 — 2026-04)              ║
 * ║                                                                  ║
 * ║  Table:  admin_notification_templates                            ║
 * ║  Scope:  Super Admin system notifications ONLY                   ║
 * ║          (separate from merchant 'message_templates' — different ║
 * ║           schema which uses body/status/tenantId)                ║
 * ║                                                                  ║
 * ║  Use cases:                                                      ║
 * ║   • New merchant welcome messages                                ║
 * ║   • Subscription expiry / expired alerts                         ║
 * ║   • Account suspension notices                                   ║
 * ║   • Payment received confirmations                               ║
 * ║   • Manual promotional / maintenance announcements               ║
 * ║                                                                  ║
 * ║  v3 additions:                                                   ║
 * ║   • deletedAt    — soft delete (recoverable)                     ║
 * ║   • sentCount    — total successful sends                        ║
 * ║   • lastSentAt   — last successful send timestamp                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export enum TriggerEvent {
  NEW_MERCHANT_REGISTERED = 'NEW_MERCHANT_REGISTERED',
  SUBSCRIPTION_EXPIRING = 'SUBSCRIPTION_EXPIRING',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  WELCOME_MESSAGE = 'WELCOME_MESSAGE',
  WHATSAPP_DISCONNECTED = 'WHATSAPP_DISCONNECTED',
  CUSTOM_MANUAL_SEND = 'CUSTOM_MANUAL_SEND',
}

export enum MessageChannel {
  WHATSAPP = 'whatsapp',
  EMAIL = 'email',
  BOTH = 'both',
}

export enum MessageLanguage {
  AR = 'ar',
  EN = 'en',
}

@Entity('admin_notification_templates')
@Index(['triggerEvent', 'channel', 'language', 'isActive'])
@Index(['deletedAt'])
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'trigger_event', type: 'varchar', length: 100 })
  triggerEvent: TriggerEvent;

  @Column({ type: 'varchar', length: 20, default: MessageChannel.WHATSAPP })
  channel: MessageChannel;

  @Column({ type: 'varchar', length: 5, default: MessageLanguage.AR })
  language: MessageLanguage;

  /**
   * Supports variables: {{merchant_name}}, {{email}}, {{login_url}}, etc.
   */
  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'subject', type: 'varchar', length: 500, nullable: true })
  subject?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  @Index('idx_admin_notif_template_active')
  isActive: boolean;

  @Column({ name: 'version_history', type: 'jsonb', default: [] })
  versionHistory: Array<{
    version: number;
    content: string;
    updatedAt: string;
    updatedBy: string;
  }>;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string;

  // ─── v3 additions ───────────────────────────────────────────────

  /** عدد مرات الإرسال الناجحة لهذا القالب */
  @Column({ name: 'sent_count', type: 'int', default: 0 })
  sentCount: number;

  /** وقت آخر إرسال ناجح */
  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt?: Date;

  /** Soft delete — يُحدَّث عند الحذف بدل الحذف النهائي */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  // ─── Timestamps ─────────────────────────────────────────────────

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
