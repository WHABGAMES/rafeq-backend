/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Unanswered Questions Entity                          ║
 * ║                                                                                ║
 * ║  ✅ التعلم الذاتي — تسجيل الأسئلة التي فشل البوت في إجابتها                  ║
 * ║  يُجمّع الأسئلة المتشابهة تلقائياً بـ embedding similarity                    ║
 * ║  يعرضها للتاجر مرتبة بالتكرار → التاجر يضيف الجواب → البوت يتعلم             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export enum UnansweredStatus {
  PENDING = 'pending',     // ينتظر جواب من التاجر
  RESOLVED = 'resolved',   // التاجر أضاف الجواب للمكتبة
  DISMISSED = 'dismissed',  // التاجر تجاهله (مش مهم)
}

@Entity('ai_unanswered_questions')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'hitCount'])
export class UnansweredQuestion extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_unanswered_tenant')
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string;

  /**
   * السؤال التمثيلي — أول سؤال في المجموعة
   * يمثّل كل الأسئلة المشابهة
   */
  @Column({ name: 'representative_question', type: 'text' })
  representativeQuestion: string;

  /**
   * عيّنات من الصياغات المختلفة — آخر 5 صياغات
   * يساعد التاجر يفهم كيف العملاء يسألون نفس السؤال
   */
  @Column({ name: 'sample_variations', type: 'jsonb', default: '[]' })
  sampleVariations: string[];

  /**
   * عدد مرات تكرار السؤال (أو أسئلة مشابهة)
   */
  @Column({ name: 'hit_count', type: 'int', default: 1 })
  hitCount: number;

  /**
   * آخر مرة سُئل فيها هذا السؤال
   */
  @Column({ name: 'last_asked_at', type: 'timestamptz', default: () => 'NOW()' })
  lastAskedAt: Date;

  /**
   * Intent المُكتشف (PRODUCT_QUESTION, POLICY_SUPPORT_FAQ, etc.)
   */
  @Column({ name: 'detected_intent', type: 'varchar', length: 50, nullable: true })
  detectedIntent?: string;

  /**
   * الحالة
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: UnansweredStatus.PENDING,
  })
  status: UnansweredStatus;

  /**
   * Embedding للسؤال التمثيلي — يُستخدم لتجميع الأسئلة المتشابهة
   */
  @Column({ type: 'jsonb', nullable: true })
  embedding?: number[];

  /**
   * ID المعلومة في المكتبة (إذا التاجر أضاف الجواب)
   */
  @Column({ name: 'resolved_knowledge_id', type: 'uuid', nullable: true })
  resolvedKnowledgeId?: string;
}
