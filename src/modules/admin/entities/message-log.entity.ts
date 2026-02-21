import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum MessageStatus {
  SENT = 'sent',
  FAILED = 'failed',
  PENDING = 'pending',
  RETRYING = 'retrying',
}

@Entity('message_logs')
@Index(['recipientUserId', 'createdAt'])
@Index(['status', 'createdAt'])
export class MessageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recipient_user_id', type: 'uuid', nullable: true })
  @Index('idx_msglog_recipient')
  recipientUserId?: string;

  @Column({ name: 'recipient_phone', type: 'varchar', length: 30, nullable: true })
  recipientPhone?: string;

  @Column({ name: 'recipient_email', type: 'varchar', length: 255, nullable: true })
  recipientEmail?: string;

  @Column({ type: 'varchar', length: 50 })
  channel: string;

  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId?: string;

  @Column({ name: 'trigger_event', type: 'varchar', length: 100, nullable: true })
  triggerEvent?: string;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.PENDING })
  status: MessageStatus;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'response_payload', type: 'jsonb', nullable: true })
  responsePayload?: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
