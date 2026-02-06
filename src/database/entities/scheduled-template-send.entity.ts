/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║        RAFIQ PLATFORM - Scheduled Template Send Entity                         ║
 * ║                                                                                ║
 * ║  📌 يتتبع الرسائل المجدولة (المؤجلة) قبل إرسالها                              ║
 * ║  ✅ يمنع التكرار — لا يرسل نفس القالب لنفس العميل مرتين                       ║
 * ║  ✅ يدعم الإلغاء — لو العميل أكمل الطلب تُلغى التذكيرات                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
} from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ScheduledSendStatus {
  /** في انتظار وقت الإرسال */
  PENDING = 'pending',
  /** تم الإرسال بنجاح */
  SENT = 'sent',
  /** تم الإلغاء (العميل أكمل الإجراء المطلوب) */
  CANCELLED = 'cancelled',
  /** فشل الإرسال */
  FAILED = 'failed',
  /** تم التخطي (تكرار أو شرط غير متحقق) */
  SKIPPED = 'skipped',
}

@Entity('scheduled_template_sends')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'templateId', 'customerPhone', 'status'])
@Index(['scheduledAt'])
@Index(['bullJobId'])
@Index(['referenceId', 'sequenceGroupKey', 'tenantId'])
export class ScheduledTemplateSend extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string;

  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @Column({ name: 'template_name', type: 'varchar', length: 255 })
  templateName: string;

  /** رقم هاتف العميل */
  @Column({ name: 'customer_phone', type: 'varchar', length: 30 })
  customerPhone: string;

  /** اسم العميل */
  @Column({ name: 'customer_name', type: 'varchar', length: 255, nullable: true })
  customerName?: string;

  /** معرّف مرجعي (orderId, cartId, ...) لمنع التكرار والإلغاء */
  @Column({ name: 'reference_id', type: 'varchar', length: 100, nullable: true })
  referenceId?: string;

  /** نوع المرجع (order, cart, customer) */
  @Column({ name: 'reference_type', type: 'varchar', length: 50, nullable: true })
  referenceType?: string;

  /** مفتاح التسلسل — لربط قوالب السلة المتروكة 1+2+3 معاً */
  @Column({ name: 'sequence_group_key', type: 'varchar', length: 100, nullable: true })
  sequenceGroupKey?: string;

  /** ترتيب القالب في التسلسل */
  @Column({ name: 'sequence_order', type: 'int', nullable: true })
  sequenceOrder?: number;

  /** الحدث الأصلي الذي أنشأ هذا الإرسال */
  @Column({ name: 'trigger_event', type: 'varchar', length: 100 })
  triggerEvent: string;

  /** الحالة */
  @Column({
    type: 'enum',
    enum: ScheduledSendStatus,
    default: ScheduledSendStatus.PENDING,
  })
  status: ScheduledSendStatus;

  /** وقت الإرسال المجدول */
  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  /** وقت الإرسال الفعلي */
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  /** وقت الإلغاء */
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date;

  /** سبب الإلغاء */
  @Column({ name: 'cancel_reason', type: 'varchar', length: 255, nullable: true })
  cancelReason?: string;

  /** معرّف Job في BullMQ — للإلغاء */
  @Column({ name: 'bull_job_id', type: 'varchar', length: 255, nullable: true })
  bullJobId?: string;

  /** البيانات الأصلية (webhook payload) */
  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  /** الرسالة النهائية بعد استبدال المتغيرات */
  @Column({ name: 'final_message', type: 'text', nullable: true })
  finalMessage?: string;

  /** رسالة الخطأ في حالة الفشل */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  /** عدد محاولات الإرسال */
  @Column({ type: 'int', default: 0 })
  attempts: number;
}
