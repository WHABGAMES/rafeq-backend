import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Admin Notification Template Entity                              ║
 * ║                                                                  ║
 * ║  FIX: Table renamed from 'message_templates' to                 ║
 * ║       'admin_notification_templates'                             ║
 * ║                                                                  ║
 * ║  WHY: 'message_templates' is already used by the merchant       ║
 * ║       platform (different schema: body, status, tenantId...)    ║
 * ║       Sharing the same table caused: column "content" does      ║
 * ║       not exist                                                  ║
 * ║                                                                  ║
 * ║  This table is EXCLUSIVELY for Super Admin system notifications: ║
 * ║  - New merchant welcome messages                                  ║
 * ║  - Subscription expiry alerts                                    ║
 * ║  - Account suspension notices                                    ║
 * ║  - Payment received confirmations                                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export enum TriggerEvent {
  NEW_MERCHANT_REGISTERED = 'NEW_MERCHANT_REGISTERED',
  SUBSCRIPTION_EXPIRING = 'SUBSCRIPTION_EXPIRING',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  WELCOME_MESSAGE = 'WELCOME_MESSAGE',
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

// ─── FIX: Use 'admin_notification_templates' — separate from merchant 'message_templates' ───
@Entity('admin_notification_templates')
@Index(['triggerEvent', 'channel', 'language', 'isActive'])
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  // FIX: Use varchar instead of enum to avoid enum name conflicts with merchant table
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
