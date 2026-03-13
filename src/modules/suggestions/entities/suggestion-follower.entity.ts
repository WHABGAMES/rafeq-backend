/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestion Follower Entity                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

@Entity('suggestion_followers')
@Unique('uq_suggestion_follower_merchant', ['suggestionId', 'merchantId'])
@Index(['suggestionId'])
@Index(['merchantId'])
export class SuggestionFollower extends BaseEntity {

  @Column({ name: 'suggestion_id', type: 'uuid' })
  suggestionId: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;
}
