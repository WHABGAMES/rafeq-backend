/**
 * AdminUser Entity
 * Audited 2026-02-21
 *
 * FIX [TS2322]: refreshToken accepts null for session invalidation
 * - string      → active session (hashed token stored)
 * - null/undefined → session cleared (logout / security lockout)
 */
import {
  Entity,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AdminRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  SUPPORT = 'support',
}

export enum AdminStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_SUSPEND: 'users.suspend',
  USERS_RESET_PASSWORD: 'users.reset_password',
  USERS_CHANGE_EMAIL: 'users.change_email',
  USERS_MERGE: 'users.merge',
  USERS_DELETE: 'users.delete',
  USERS_HARD_DELETE: 'users.hard_delete',  // ✅ حذف كامل من DB (owner only)
  STORES_TRANSFER: 'stores.transfer',
  AUDIT_READ: 'audit.read',
  SYSTEM_METRICS: 'system.metrics',
  IMPERSONATE_ACCESS: 'impersonate.access',
  WHATSAPP_MANAGE: 'whatsapp.manage',
  TEMPLATES_MANAGE: 'templates.manage',
  PLATFORM_FEATURES_MANAGE: 'platform_features.manage',
  ADMIN_INBOX_READ: 'admin_inbox.read',
  ADMIN_INBOX_MANAGE: 'admin_inbox.manage',
  TELEGRAM_MANAGE: 'telegram.manage',
  MAINTENANCE_MANAGE: 'maintenance.manage',
  PLATFORM_NOTIFICATIONS_MANAGE: 'platform_notifications.manage',
  SUBSCRIPTIONS_MANAGE: 'subscriptions.manage',
  SUGGESTIONS_READ: 'suggestions.read',
  SUGGESTIONS_MANAGE: 'suggestions.manage',
  ADMIN_ALERTS_READ: 'admin_alerts.read',
  ADMIN_ALERTS_MANAGE: 'admin_alerts.manage',
  ADMIN_ALERTS_TEST: 'admin_alerts.test',
  BACKUPS_READ: 'backups.read',
  BACKUPS_MANAGE: 'backups.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  [AdminRole.OWNER]: Object.values(PERMISSIONS),
  [AdminRole.ADMIN]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_SUSPEND,
    PERMISSIONS.USERS_RESET_PASSWORD,
    PERMISSIONS.USERS_CHANGE_EMAIL,
    PERMISSIONS.USERS_DELETE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.IMPERSONATE_ACCESS,
    PERMISSIONS.SYSTEM_METRICS,
    PERMISSIONS.WHATSAPP_MANAGE,
    PERMISSIONS.TEMPLATES_MANAGE,
    PERMISSIONS.PLATFORM_FEATURES_MANAGE,
    PERMISSIONS.ADMIN_INBOX_READ,
    PERMISSIONS.ADMIN_INBOX_MANAGE,
    PERMISSIONS.TELEGRAM_MANAGE,
    PERMISSIONS.MAINTENANCE_MANAGE,
    PERMISSIONS.PLATFORM_NOTIFICATIONS_MANAGE,
    PERMISSIONS.SUBSCRIPTIONS_MANAGE,
    PERMISSIONS.SUGGESTIONS_READ,
    PERMISSIONS.SUGGESTIONS_MANAGE,
    PERMISSIONS.ADMIN_ALERTS_READ,
    PERMISSIONS.ADMIN_ALERTS_MANAGE,
    PERMISSIONS.ADMIN_ALERTS_TEST,
    PERMISSIONS.BACKUPS_READ,
    PERMISSIONS.BACKUPS_MANAGE,
  ],
  [AdminRole.SUPPORT]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.IMPERSONATE_ACCESS,
    PERMISSIONS.SUGGESTIONS_READ,
    PERMISSIONS.ADMIN_ALERTS_READ,
  ],
};

@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index('idx_admin_email')
  email: string;

  // select: false — لا يُرجع في الـ queries إلا بالتحديد الصريح في select array
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'enum', enum: AdminRole, default: AdminRole.SUPPORT })
  @Index('idx_admin_role')
  role: AdminRole;

  @Column({ type: 'enum', enum: AdminStatus, default: AdminStatus.ACTIVE })
  status: AdminStatus;

  // select: false — لا يُرجع إلا عند الحاجة الصريحة (setup-2fa, confirm-2fa)
  @Column({ name: 'two_fa_secret', type: 'varchar', nullable: true, select: false })
  twoFaSecret?: string;

  @Column({ name: 'two_fa_enabled', type: 'boolean', default: false })
  twoFaEnabled: boolean;

  /**
   * ✅ [TS2322] FIX: string | null | undefined
   * - select: false — لا يُرجع إلا بالتحديد الصريح
   * - nullable: true — يقبل NULL في قاعدة البيانات
   * - null يُستخدم في logout و security lockout:
   *   await repo.update(id, { refreshToken: null })
   */
  @Column({ name: 'refresh_token', type: 'varchar', length: 500, nullable: true, select: false })
  refreshToken?: string | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'last_login_ip', type: 'varchar', length: 45, nullable: true })
  lastLoginIp?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim();
  }

  hasPermission(permission: Permission): boolean {
    return ROLE_PERMISSIONS[this.role]?.includes(permission) ?? false;
  }
}
