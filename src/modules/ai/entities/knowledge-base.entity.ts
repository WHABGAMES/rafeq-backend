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

@Entity('knowledge_base')
@Index(['tenantId', 'category'])
@Index(['tenantId', 'isActive'])
export class KnowledgeBase extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_knowledge_base_tenant')
  tenantId: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text' })
  content: string;

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
