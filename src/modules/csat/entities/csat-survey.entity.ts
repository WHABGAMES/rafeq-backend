/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - CSAT Survey Entity                               ║
 * ║                                                                                ║
 * ║  📌 كيان تقييم رضا العملاء — مخزّن في قاعدة البيانات                          ║
 * ║  يحتوي على: التقييم، الملاحظات، المحادثة، العميل، الموظف                     ║
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

export enum CsatSurveyType {
  CSAT   = 'csat',   // Customer Satisfaction Score (1-5)
  NPS    = 'nps',    // Net Promoter Score (0-10)
  CES    = 'ces',    // Customer Effort Score (1-7)
  THUMBS = 'thumbs', // Thumbs Up/Down
}

export enum CsatSurveyStatus {
  SENT      = 'sent',      // تم إرسال رابط الاستطلاع
  OPENED    = 'opened',    // فتح العميل الرابط
  COMPLETED = 'completed', // أكمل العميل التقييم
  EXPIRED   = 'expired',   // انتهت صلاحية الرابط
}

// ═══════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════

@Entity('csat_surveys')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'conversationId'])
@Index(['token'], { unique: true })
export class CsatSurvey extends BaseEntity {

  // ─────────────────────────────────────────────
  // Tenant & Store
  // ─────────────────────────────────────────────

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId: string | null;

  // ─────────────────────────────────────────────
  // Relations (IDs only — no FK for flexibility)
  // ─────────────────────────────────────────────

  @Column({ name: 'conversation_id', type: 'varchar', length: 36, nullable: true })
  conversationId: string | null;

  @Column({ name: 'customer_id', type: 'varchar', length: 36, nullable: true })
  customerId: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  // ─────────────────────────────────────────────
  // Survey Config
  // ─────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: CsatSurveyType,
    default: CsatSurveyType.CSAT,
  })
  type: CsatSurveyType;

  @Column({
    type: 'enum',
    enum: CsatSurveyStatus,
    default: CsatSurveyStatus.SENT,
  })
  status: CsatSurveyStatus;

  /**
   * توكن فريد لرابط التقييم
   * يُستخدم في: https://app.rafeq.ai/csat/{token}
   */
  @Column({ type: 'varchar', length: 255 })
  token: string;

  // ─────────────────────────────────────────────
  // Survey Response
  // ─────────────────────────────────────────────

  /**
   * التقييم المُدخل من العميل
   * CSAT: 1-5  |  NPS: 0-10  |  CES: 1-7  |  Thumbs: 1(up)/0(down)
   */
  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  /**
   * ملاحظات العميل النصية (اختياري)
   */
  @Column({ type: 'text', nullable: true })
  feedback: string | null;

  /**
   * وقت إتمام التقييم من العميل
   */
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  /**
   * انتهاء صلاحية الرابط (افتراضي 7 أيام)
   */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /**
   * بيانات إضافية (metadata) كـ JSON
   * مثال: { orderNumber: '#123', source: 'whatsapp' }
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
