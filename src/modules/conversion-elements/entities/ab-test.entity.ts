/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - A/B Test Entity                                      ║
 * ║                                                                                ║
 * ║  Links two element variants for split testing.                                ║
 * ║  Traffic is split 50/50 by session_id hash.                                   ║
 * ║  Auto-winner selection based on conversion rate.                              ║
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

export enum ABTestStatus {
  RUNNING   = 'running',
  COMPLETED = 'completed',
  PAUSED    = 'paused',
  CANCELLED = 'cancelled',
}

@Entity('ab_tests')
@Index(['storeId'])
export class ABTest {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  // ─── Variants ─────────────────────────────────────────────────
  @Column({ name: 'element_a_id', type: 'uuid' })
  elementAId: string;

  @Column({ name: 'element_b_id', type: 'uuid' })
  elementBId: string;

  @Column({ name: 'traffic_split', type: 'integer', default: 50 })
  trafficSplit: number;           // % for variant A (B gets 100 - this)

  // ─── Status ───────────────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: ABTestStatus,
    default: ABTestStatus.RUNNING,
  })
  status: ABTestStatus;

  // ─── Auto-Complete Rules ──────────────────────────────────────
  @Column({ name: 'min_views_per_variant', type: 'integer', default: 100 })
  minViewsPerVariant: number;

  @Column({ name: 'confidence_threshold', type: 'decimal', precision: 5, scale: 2, default: 95 })
  confidenceThreshold: number;    // statistical significance %

  // ─── Results ──────────────────────────────────────────────────
  @Column({ name: 'winner_variant', type: 'varchar', length: 10, nullable: true })
  winnerVariant?: string;         // 'A' | 'B'

  @Column({ name: 'winner_element_id', type: 'uuid', nullable: true })
  winnerElementId?: string;

  @Column({ name: 'confidence_level', type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidenceLevel?: number;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
