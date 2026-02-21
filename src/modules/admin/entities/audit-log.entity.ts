import {
  Entity,
  Column,
  Index,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  BeforeUpdate,
  BeforeRemove,
} from 'typeorm';

export enum AuditAction {
  // User actions
  USER_SUSPENDED = 'user.suspended',
  USER_REACTIVATED = 'user.reactivated',
  USER_PASSWORD_RESET = 'user.password_reset',
  USER_EMAIL_CHANGED = 'user.email_changed',
  USER_MERGED = 'user.merged',
  USER_SOFT_DELETED = 'user.soft_deleted',
  // Store actions
  STORE_TRANSFERRED = 'store.transferred',
  // Admin actions
  ADMIN_LOGIN = 'admin.login',
  ADMIN_LOGOUT = 'admin.logout',
  IMPERSONATION_STARTED = 'impersonation.started',
  IMPERSONATION_ENDED = 'impersonation.ended',
  // WhatsApp
  WHATSAPP_SETTINGS_UPDATED = 'whatsapp.settings_updated',
  WHATSAPP_TEST_SENT = 'whatsapp.test_sent',
  // Templates
  TEMPLATE_CREATED = 'template.created',
  TEMPLATE_UPDATED = 'template.updated',
  TEMPLATE_DELETED = 'template.deleted',
  // Notifications
  NOTIFICATION_SENT = 'notification.sent',
  NOTIFICATION_FAILED = 'notification.failed',
}

@Entity('audit_logs')
@Index(['actorId', 'createdAt'])
@Index(['targetType', 'targetId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  @Index('idx_audit_actor')
  actorId: string;

  @Column({ name: 'actor_email', type: 'varchar', length: 255 })
  actorEmail: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 50 })
  actorRole: string;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 100, nullable: true })
  targetType?: string;

  @Column({ name: 'target_id', type: 'varchar', length: 255, nullable: true })
  targetId?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Prevent any updates or deletes - logs are IMMUTABLE
  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Audit logs are immutable and cannot be updated');
  }

  @BeforeRemove()
  preventDelete() {
    throw new Error('Audit logs are immutable and cannot be deleted');
  }
}
