import {
  Entity,
  Column,
  Index,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  BeforeUpdate,
  BeforeRemove,
} from 'typeorm';

// ═══════════════════════════════════════════════════════════════════════════════
// Audit Actions — Admin + Tenant
// ═══════════════════════════════════════════════════════════════════════════════

export enum AuditAction {
  // ── Admin actions ──
  ADMIN_LOGIN = 'admin.login',
  ADMIN_LOGOUT = 'admin.logout',
  IMPERSONATION_STARTED = 'impersonation.started',
  IMPERSONATION_ENDED = 'impersonation.ended',

  // ── Admin → User actions ──
  USER_SUSPENDED = 'user.suspended',
  USER_REACTIVATED = 'user.reactivated',
  USER_PASSWORD_RESET = 'user.password_reset',
  USER_EMAIL_CHANGED = 'user.email_changed',
  USER_MERGED = 'user.merged',
  USER_SOFT_DELETED = 'user.soft_deleted',

  // ── Admin → Store actions ──
  STORE_TRANSFERRED = 'store.transferred',

  // ── Admin → WhatsApp ──
  WHATSAPP_SETTINGS_UPDATED = 'whatsapp.settings_updated',
  WHATSAPP_TEST_SENT = 'whatsapp.test_sent',

  // ── Admin → Templates ──
  TEMPLATE_CREATED = 'template.created',
  TEMPLATE_UPDATED = 'template.updated',
  TEMPLATE_DELETED = 'template.deleted',

  // ── Admin → Notifications ──
  NOTIFICATION_SENT = 'notification.sent',
  NOTIFICATION_FAILED = 'notification.failed',

  // ── Admin → Subscription ──
  SUBSCRIPTION_PLAN_SET = 'subscription.plan_set',

  // ═══════════════════════════════════════════════════════════════════════════
  // Tenant (Merchant) Actions
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Auth ──
  TENANT_LOGIN = 'tenant.login',
  TENANT_REGISTER = 'tenant.register',
  TENANT_LOGOUT = 'tenant.logout',
  TENANT_PASSWORD_CHANGED = 'tenant.password_changed',
  TENANT_SALLA_LOGIN = 'tenant.salla_login',
  TENANT_ZID_LOGIN = 'tenant.zid_login',

  // ── Store ──
  TENANT_STORE_CONNECTED = 'tenant.store_connected',
  TENANT_STORE_DISCONNECTED = 'tenant.store_disconnected',
  TENANT_STORE_SETTINGS_UPDATED = 'tenant.store_settings_updated',

  // ── AI Bot ──
  TENANT_AI_ENABLED = 'tenant.ai_enabled',
  TENANT_AI_DISABLED = 'tenant.ai_disabled',
  TENANT_AI_SETTINGS_UPDATED = 'tenant.ai_settings_updated',
  TENANT_AI_KNOWLEDGE_ADDED = 'tenant.ai_knowledge_added',
  TENANT_AI_KNOWLEDGE_DELETED = 'tenant.ai_knowledge_deleted',

  // ── Channels ──
  TENANT_CHANNEL_CONNECTED = 'tenant.channel_connected',
  TENANT_CHANNEL_DISCONNECTED = 'tenant.channel_disconnected',

  // ── Templates ──
  TENANT_TEMPLATE_ACTIVATED = 'tenant.template_activated',
  TENANT_TEMPLATE_DEACTIVATED = 'tenant.template_deactivated',
  TENANT_TEMPLATE_UPDATED = 'tenant.template_updated',

  // ── Campaigns ──
  TENANT_CAMPAIGN_CREATED = 'tenant.campaign_created',
  TENANT_CAMPAIGN_SENT = 'tenant.campaign_sent',

  // ── OTP ──
  TENANT_OTP_SERVICE_CREATED = 'tenant.otp_service_created',
  TENANT_OTP_SERVICE_UPDATED = 'tenant.otp_service_updated',

  // ── Settings ──
  TENANT_SETTINGS_UPDATED = 'tenant.settings_updated',

  // ── Staff ──
  TENANT_STAFF_ADDED = 'tenant.staff_added',
  TENANT_STAFF_REMOVED = 'tenant.staff_removed',
}

// ═══════════════════════════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════════════════════════

@Entity('audit_logs')
@Index(['actorId', 'createdAt'])
@Index(['targetType', 'targetId'])
@Index(['tenantId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Actor (who performed the action) ──
  @Column({ name: 'actor_id', type: 'uuid' })
  @Index('idx_audit_actor')
  actorId: string;

  @Column({ name: 'actor_email', type: 'varchar', length: 255 })
  actorEmail: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 50 })
  actorRole: string;

  // ── Tenant (merchant) context — nullable for admin actions ──
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  @Index('idx_audit_tenant')
  tenantId?: string;

  @Column({ name: 'tenant_name', type: 'varchar', length: 255, nullable: true })
  tenantName?: string;

  @Column({ name: 'store_name', type: 'varchar', length: 255, nullable: true })
  storeName?: string;

  // ── Action ──
  @Column({ type: 'varchar', length: 100 })
  action: string;

  // ── Target ──
  @Column({ name: 'target_type', type: 'varchar', length: 100, nullable: true })
  targetType?: string;

  @Column({ name: 'target_id', type: 'varchar', length: 255, nullable: true })
  targetId?: string;

  // ── Context ──
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Immutable — prevent updates and deletes
  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Audit logs are immutable and cannot be updated');
  }

  @BeforeRemove()
  preventDelete() {
    throw new Error('Audit logs are immutable and cannot be deleted');
  }
}
