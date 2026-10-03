import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PlatformBackupStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum PlatformBackupTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

@Entity('platform_backups')
@Index('idx_platform_backups_created', ['createdAt'])
@Index('idx_platform_backups_status', ['status'])
export class PlatformBackup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: PlatformBackupStatus })
  status: PlatformBackupStatus;

  @Column({ type: 'enum', enum: PlatformBackupTrigger })
  trigger: PlatformBackupTrigger;

  @Column({ name: 'object_key', type: 'varchar', length: 500, nullable: true })
  objectKey?: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes?: string | null;

  @Column({ name: 'sha256', type: 'char', length: 64, nullable: true })
  sha256?: string | null;

  @Column({ name: 'encryption_key_id', type: 'char', length: 16, nullable: true })
  encryptionKeyId?: string | null;

  @Column({ name: 'database_name', type: 'varchar', length: 128 })
  databaseName: string;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy?: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({
    name: 'error_message',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  errorMessage?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
