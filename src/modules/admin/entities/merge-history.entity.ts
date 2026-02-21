import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

export enum MergeStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  ROLLED_BACK = 'rolled_back',
  FAILED = 'failed',
}

@Entity('merge_history')
export class MergeHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_user_id', type: 'uuid' })
  @Index('idx_merge_source')
  sourceUserId: string;

  @Column({ name: 'source_email', type: 'varchar', length: 255 })
  sourceEmail: string;

  @Column({ name: 'target_user_id', type: 'uuid' })
  @Index('idx_merge_target')
  targetUserId: string;

  @Column({ name: 'target_email', type: 'varchar', length: 255 })
  targetEmail: string;

  @Column({ name: 'performed_by', type: 'uuid' })
  performedBy: string;

  @Column({ name: 'performed_by_email', type: 'varchar', length: 255 })
  performedByEmail: string;

  @Column({ type: 'enum', enum: MergeStatus, default: MergeStatus.PENDING })
  status: MergeStatus;

  @Column({ name: 'stores_transferred', type: 'int', default: 0 })
  storesTransferred: number;

  @Column({ name: 'transferred_store_ids', type: 'jsonb', default: [] })
  transferredStoreIds: string[];

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
