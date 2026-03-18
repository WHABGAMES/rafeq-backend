/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Element Analytics (Daily Rollup)                     ║
 * ║                                                                                ║
 * ║  Pre-aggregated daily statistics per element.                                 ║
 * ║  Computed by a scheduled CRON job that runs hourly.                           ║
 * ║                                                                                ║
 * ║  Why:                                                                          ║
 * ║  - Querying millions of raw events is expensive                               ║
 * ║  - Dashboard needs fast reads                                                 ║
 * ║  - This table stays small (1 row per element per day)                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('element_analytics_daily')
@Index(['storeId', 'date'], { unique: false })
@Index(['elementId', 'date'], { unique: true })
@Index(['storeId', 'elementId', 'date'])
export class ElementAnalyticsDaily {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'element_id', type: 'uuid' })
  elementId: string;

  @Column({ name: 'element_type', type: 'varchar', length: 50 })
  elementType: string;

  @Column({ name: 'variant_label', type: 'varchar', length: 10, nullable: true })
  variantLabel?: string;

  // ─── The Date ─────────────────────────────────────────────────
  @Column({ type: 'date' })
  date: string;                   // 'YYYY-MM-DD'

  // ─── Core Metrics ─────────────────────────────────────────────
  @Column({ type: 'integer', default: 0 })
  views: number;

  @Column({ type: 'integer', default: 0 })
  clicks: number;

  @Column({ type: 'integer', default: 0 })
  closes: number;

  @Column({ type: 'integer', default: 0 })
  submits: number;

  @Column({ name: 'cta_clicks', type: 'integer', default: 0 })
  ctaClicks: number;

  @Column({ name: 'add_to_carts', type: 'integer', default: 0 })
  addToCarts: number;

  @Column({ type: 'integer', default: 0 })
  purchases: number;

  // ─── Revenue Metrics ──────────────────────────────────────────
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  revenue: number;

  @Column({ name: 'avg_order_value', type: 'decimal', precision: 12, scale: 2, default: 0 })
  avgOrderValue: number;

  // ─── Computed Rates ───────────────────────────────────────────
  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  ctr: number;                    // clicks / views * 100

  @Column({ name: 'conversion_rate', type: 'decimal', precision: 8, scale: 4, default: 0 })
  conversionRate: number;         // purchases / views * 100

  // ─── Unique Counts ────────────────────────────────────────────
  @Column({ name: 'unique_visitors', type: 'integer', default: 0 })
  uniqueVisitors: number;

  @Column({ name: 'unique_clickers', type: 'integer', default: 0 })
  uniqueClickers: number;

  // ─── Device Breakdown ─────────────────────────────────────────
  @Column({ name: 'mobile_views', type: 'integer', default: 0 })
  mobileViews: number;

  @Column({ name: 'desktop_views', type: 'integer', default: 0 })
  desktopViews: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
