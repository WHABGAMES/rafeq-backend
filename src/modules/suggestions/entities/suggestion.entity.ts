/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestion Entity                                ║
 * ║                                                                                ║
 * ║  📌 كيان الاقتراحات والمشاكل — مخزّن في قاعدة البيانات                          ║
 * ║  يحتوي على: العنوان، الوصف، النوع، الحالة، الأصوات                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

// ═══════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════

export enum SuggestionType {
  FEATURE_REQUEST = 'feature_request',     // اقتراح تطوير
  BUG_REPORT = 'bug_report',               // مشكلة تقنية
  NEW_FEATURE = 'new_feature',             // طلب ميزة جديدة
  IMPROVEMENT = 'improvement',             // تحسين ميزة
}

export enum SuggestionStatus {
  UNDER_REVIEW = 'under_review',           // قيد المراجعة
  UNDER_STUDY = 'under_study',             // قيد الدراسة
  IN_PROGRESS = 'in_progress',             // قيد التنفيذ
  COMPLETED = 'completed',                 // تم التنفيذ
  REJECTED = 'rejected',                   // مرفوض
}

// ═══════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════

@Entity('suggestions')
@Index(['status', 'isPinned', 'likesCount'])
@Index(['merchantId'])
@Index(['type'])
@Index(['createdAt'])
@Index(['mergedIntoId'])
export class Suggestion extends BaseEntity {

  // ─────────────────────────────────────────────
  // Content
  // ─────────────────────────────────────────────

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: SuggestionType,
    default: SuggestionType.FEATURE_REQUEST,
  })
  type: SuggestionType;

  // ─────────────────────────────────────────────
  // Merchant (creator)
  // ─────────────────────────────────────────────

  /** ID المستخدم (User) الذي أنشأ الاقتراح */
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  /** tenant_id للتحقق من الهوية في Admin */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** اسم العرض — يُخزّن وقت الإنشاء لأداء أفضل */
  @Column({ name: 'merchant_name', type: 'varchar', length: 255, nullable: true })
  merchantName: string | null;

  /** اسم المتجر */
  @Column({ name: 'store_name', type: 'varchar', length: 255, nullable: true })
  storeName: string | null;

  // ─────────────────────────────────────────────
  // Anonymous
  // ─────────────────────────────────────────────

  @Column({ name: 'is_anonymous', type: 'boolean', default: false })
  isAnonymous: boolean;

  // ─────────────────────────────────────────────
  // Status & Moderation
  // ─────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: SuggestionStatus,
    default: SuggestionStatus.UNDER_REVIEW,
  })
  status: SuggestionStatus;

  @Column({ name: 'is_pinned', type: 'boolean', default: false })
  isPinned: boolean;

  // ─────────────────────────────────────────────
  // Counters (denormalized for performance)
  // ─────────────────────────────────────────────

  @Column({ name: 'likes_count', type: 'int', default: 0 })
  likesCount: number;

  @Column({ name: 'comments_count', type: 'int', default: 0 })
  commentsCount: number;

  @Column({ name: 'followers_count', type: 'int', default: 0 })
  followersCount: number;

  // ─────────────────────────────────────────────
  // Merge Support
  // ─────────────────────────────────────────────

  /** إذا تم دمج هذا الاقتراح في اقتراح آخر */
  @Column({ name: 'merged_into_id', type: 'uuid', nullable: true })
  mergedIntoId: string | null;

  // ─────────────────────────────────────────────
  // Admin Response indicator
  // ─────────────────────────────────────────────

  @Column({ name: 'has_admin_response', type: 'boolean', default: false })
  hasAdminResponse: boolean;

  /** آخر تعليق من فريق الأدمن */
  @Column({ name: 'admin_response_preview', type: 'varchar', length: 500, nullable: true })
  adminResponsePreview: string | null;
}
