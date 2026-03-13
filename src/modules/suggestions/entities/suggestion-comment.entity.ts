/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestion Comment Entity                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

@Entity('suggestion_comments')
@Index(['suggestionId', 'createdAt'])
@Index(['merchantId'])
export class SuggestionComment extends BaseEntity {

  @Column({ name: 'suggestion_id', type: 'uuid' })
  suggestionId: string;

  /** null for admin comments */
  @Column({ name: 'merchant_id', type: 'uuid', nullable: true })
  merchantId: string | null;

  @Column({ type: 'text' })
  comment: string;

  /** Is this an admin/team response? */
  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin: boolean;

  /** Admin user ID if admin comment */
  @Column({ name: 'admin_id', type: 'uuid', nullable: true })
  adminId: string | null;

  /** Admin display name */
  @Column({ name: 'admin_name', type: 'varchar', length: 255, nullable: true })
  adminName: string | null;

  /** Merchant display name (cached) */
  @Column({ name: 'merchant_name', type: 'varchar', length: 255, nullable: true })
  merchantName: string | null;

  /** Store name (cached) */
  @Column({ name: 'store_name', type: 'varchar', length: 255, nullable: true })
  storeName: string | null;

  @Column({ name: 'is_anonymous', type: 'boolean', default: false })
  isAnonymous: boolean;
}
