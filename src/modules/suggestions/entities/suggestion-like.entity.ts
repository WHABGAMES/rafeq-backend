/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestion Like Entity                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

@Entity('suggestion_likes')
@Unique('uq_suggestion_like_merchant', ['suggestionId', 'merchantId'])
@Index(['suggestionId'])
@Index(['merchantId'])
export class SuggestionLike extends BaseEntity {

  @Column({ name: 'suggestion_id', type: 'uuid' })
  suggestionId: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;
}
