/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Knowledge Base Entity                             ║
 * ║                                                                                ║
 * ║  ✅ مكتبة المعلومات التي يستخدمها البوت للرد على العملاء                       ║
 * ║  ✅ يرث من BaseEntity (id, createdAt, updatedAt, deletedAt)                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export enum KnowledgeCategory {
  SHIPPING = 'shipping',
  RETURNS = 'returns',
  PAYMENT = 'payment',
  PRODUCTS = 'products',
  GENERAL = 'general',
  CUSTOM = 'custom',
}

/**
 * ✅ BUG-KB1 FIX: نوع المعلومة — article (مقال) أو qna (سؤال وجواب)
 * الواجهة الأمامية ترسل هذا الحقل عند الإضافة
 */
export enum KnowledgeType {
  ARTICLE = 'article',
  QNA = 'qna',
}

@Entity('knowledge_base')
@Index(['tenantId', 'category'])
@Index(['tenantId', 'isActive'])
@Index(['tenantId', 'type'])
export class KnowledgeBase extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_knowledge_base_tenant')
  tenantId: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  /**
   * ✅ BUG-KB1 FIX: نوع المعلومة
   * article = مقال (عنوان + محتوى)
   * qna = سؤال وجواب (العنوان = السؤال، answer = الجواب)
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: KnowledgeType.ARTICLE,
    comment: 'article or qna',
  })
  type: KnowledgeType;

  /**
   * ✅ BUG-KB1 FIX: جواب السؤال (فقط لنوع qna)
   * في نوع article يكون null والمحتوى في content
   * في نوع qna العنوان = السؤال والجواب هنا
   */
  @Column({
    type: 'text',
    nullable: true,
    comment: 'Answer text for QnA type entries',
  })
  answer?: string;

  @Column({
    type: 'enum',
    enum: KnowledgeCategory,
    default: KnowledgeCategory.GENERAL,
  })
  category: KnowledgeCategory;

  @Column({
    type: 'text',
    array: true,
    default: '{}',
    comment: 'كلمات مفتاحية للبحث',
  })
  keywords: string[];

  @Column({
    type: 'int',
    default: 10,
    comment: 'أولوية الظهور (أقل = أعلى أولوية)',
  })
  priority: number;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
  })
  isActive: boolean;

  /**
   * ✅ RAG: Vector embedding (OpenAI text-embedding-3-small, 1536 dims)
   * يُولّد تلقائياً عند إضافة/تحديث المعلومة
   * يُستخدم للبحث الدلالي (Semantic Search)
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'OpenAI embedding vector for semantic search',
  })
  embedding?: number[];
}
