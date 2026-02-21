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
  USERS_DELETE: 'users.delete',        // ✅ Added: separate permission for soft-delete
  STORES_TRANSFER: 'stores.transfer',
  AUDIT_READ: 'audit.read',
  SYSTEM_METRICS: 'system.metrics',
  IMPERSONATE_ACCESS: 'impersonate.access',
  WHATSAPP_MANAGE: 'whatsapp.manage',
  TEMPLATES_MANAGE: 'templates.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  [AdminRole.OWNER]: Object.values(PERMISSIONS),
  [AdminRole.ADMIN]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_SUSPEND,
    PERMISSIONS.USERS_RESET_PASSWORD,
    PERMISSIONS.USERS_CHANGE_EMAIL,
    PERMISSIONS.USERS_DELETE,           // ✅ Admin can soft-delete
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.IMPERSONATE_ACCESS,
    PERMISSIONS.SYSTEM_METRICS,
    PERMISSIONS.WHATSAPP_MANAGE,
    PERMISSIONS.TEMPLATES_MANAGE,
  ],
  [AdminRole.SUPPORT]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.IMPERSONATE_ACCESS,
  ],
};

@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index('idx_admin_email')
  email: string;

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

  @Column({ name: 'two_fa_secret', type: 'varchar', nullable: true, select: false })
  twoFaSecret?: string;

  @Column({ name: 'two_fa_enabled', type: 'boolean', default: false })
  twoFaEnabled: boolean;

  @Column({ name: 'refresh_token', type: 'varchar', length: 500, nullable: true, select: false })
  refreshToken?: string;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'last_login_ip', type: 'varchar', length: 45, nullable: true })
  lastLoginIp?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  hasPermission(permission: Permission): boolean {
    return ROLE_PERMISSIONS[this.role]?.includes(permission) ?? false;
  }
}
