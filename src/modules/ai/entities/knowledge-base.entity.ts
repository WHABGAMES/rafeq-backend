/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Knowledge Base Entity                             ║
 * ║                                                                                ║
 * ║  ✅ مكتبة المعلومات التي يستخدمها البوت للرد على العملاء                       ║
 * ║  ✅ يدعم نوعين: معلومات عامة (article) + سؤال وجواب (qna)                     ║
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
 * ✅ نوع المعلومة في المكتبة
 * article = معلومات عامة (عنوان + محتوى)
 * qna = سؤال وجواب (سؤال + جواب)
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
   * ✅ جواب السؤال — يُستخدم فقط عندما type = 'qna'
   * في نوع article: يبقى null/فارغ
   * في نوع qna: title = السؤال، answer = الجواب
   */
  @Column({ type: 'text', nullable: true, default: null })
  answer: string | null;

  /**
   * ✅ نوع المعلومة
   * article = معلومات عامة (النظام الحالي)
   * qna = سؤال وجواب
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'article',
  })
  type: string;

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
}
