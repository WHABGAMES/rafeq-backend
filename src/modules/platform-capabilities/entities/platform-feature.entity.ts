import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum FeatureTargetMode {
  ALL = 'all',
  INCLUDE = 'include',
  EXCLUDE = 'exclude',
}

export enum PlatformFeatureStatus {
  ACTIVE = 'active',
  BETA = 'beta',
  MAINTENANCE = 'maintenance',
  HIDDEN = 'hidden',
}

@Entity('platform_features')
export class PlatformFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'feature_key', type: 'varchar', length: 100, unique: true })
  featureKey: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'parent_feature_key', type: 'varchar', length: 100, nullable: true })
  parentFeatureKey?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 80 })
  category: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  route?: string | null;

  @Column({ name: 'target_mode', type: 'enum', enum: FeatureTargetMode, default: FeatureTargetMode.ALL })
  targetMode: FeatureTargetMode;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  platforms: string[];

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'show_in_navigation', type: 'boolean', default: true })
  showInNavigation: boolean;

  @Column({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder: number;

  @Column({ name: 'required_permission', type: 'varchar', length: 100, nullable: true })
  requiredPermission?: string | null;

  @Column({ name: 'required_plan_feature', type: 'varchar', length: 100, nullable: true })
  requiredPlanFeature?: string | null;

  @Column({ type: 'enum', enum: PlatformFeatureStatus, default: PlatformFeatureStatus.ACTIVE })
  status: PlatformFeatureStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  config: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
