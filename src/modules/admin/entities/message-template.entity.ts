import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

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

@Entity('message_templates')
@Index(['triggerEvent', 'channel', 'language', 'isActive'])
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'trigger_event', type: 'enum', enum: TriggerEvent })
  triggerEvent: TriggerEvent;

  @Column({ type: 'enum', enum: MessageChannel, default: MessageChannel.WHATSAPP })
  channel: MessageChannel;

  @Column({ type: 'enum', enum: MessageLanguage, default: MessageLanguage.AR })
  language: MessageLanguage;

  /**
   * Supports variables: {{merchant_name}}, {{email}}, {{login_url}}, etc.
   */
  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'subject', type: 'varchar', length: 500, nullable: true })
  subject?: string; // For email templates

  @Column({ name: 'is_active', type: 'boolean', default: true })
  @Index('idx_template_active')
  isActive: boolean;

  /**
   * Store version snapshots for rollback / history
   */
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
