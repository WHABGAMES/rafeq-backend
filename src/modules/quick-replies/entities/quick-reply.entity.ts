/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Reply Entity                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { BaseEntity } from '@database/entities/base.entity';

@Entity('quick_replies')
@Index(['tenantId', 'shortcut'], { unique: true })
@Index(['tenantId', 'category'])
export class QuickReplyEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 30 })
  shortcut: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category?: string;

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  variables?: string[];

  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  attachments?: Array<{ type: string; url: string; name?: string }>;

  @Column({ name: 'is_global', type: 'boolean', default: false })
  isGlobal: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount: number;
}
