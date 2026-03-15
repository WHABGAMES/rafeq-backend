/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Trusted Device Entity                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('trusted_devices')
@Index(['userId'])
export class TrustedDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string;

  @Column({ name: 'device_name', type: 'varchar', length: 100 })
  deviceName: string;

  @Column({ name: 'browser', type: 'varchar', length: 50 })
  browser: string;

  @Column({ name: 'os', type: 'varchar', length: 50 })
  os: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_active_at', type: 'timestamptz', default: () => 'NOW()' })
  lastActiveAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
