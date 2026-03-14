/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Short Links Entities                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

// ═══════════════════════════════════════════════════════════════
// 🔗 SHORT LINK
// ═══════════════════════════════════════════════════════════════

@Entity('short_links')
@Index(['tenantId'])
@Index(['shortCode'], { unique: true })
export class ShortLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'short_code', type: 'varchar', length: 20 })
  shortCode: string;

  @Column({ name: 'original_url', type: 'text' })
  originalUrl: string;

  @Column({ name: 'title', type: 'varchar', length: 200, nullable: true })
  title?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'total_clicks', type: 'integer', default: 0 })
  totalClicks: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// 📊 LINK CLICK — تتبع الزيارات
// ═══════════════════════════════════════════════════════════════

@Entity('link_clicks')
@Index(['linkId'])
@Index(['tenantId'])
@Index(['clickedAt'])
export class LinkClick {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'link_id', type: 'uuid' })
  linkId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'country', type: 'varchar', length: 50, nullable: true })
  country?: string;

  @Column({ name: 'city', type: 'varchar', length: 100, nullable: true })
  city?: string;

  @Column({ name: 'device_type', type: 'varchar', length: 20, nullable: true })
  deviceType?: string;

  @Column({ name: 'browser', type: 'varchar', length: 50, nullable: true })
  browser?: string;

  @Column({ name: 'os', type: 'varchar', length: 50, nullable: true })
  os?: string;

  @Column({ name: 'referrer', type: 'varchar', length: 500, nullable: true })
  referrer?: string;

  @Column({ name: 'referrer_source', type: 'varchar', length: 30, nullable: true })
  referrerSource?: string;

  @Column({ name: 'clicked_at', type: 'timestamptz', default: () => 'NOW()' })
  clickedAt: Date;
}
