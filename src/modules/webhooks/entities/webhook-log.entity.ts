/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Webhook Log Entity                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';
import { WebhookEvent } from './webhook-event.entity';
import { Tenant } from '../../../database/entities/tenant.entity';

export enum WebhookLogAction {
  RECEIVED = 'received',
  PROCESSING_STARTED = 'processing_started',
  PROCESSED = 'processed',
  PROCESSING_FAILED = 'processing_failed',
  SKIPPED_DUPLICATE = 'skipped_duplicate',
  SKIPPED_INVALID_SIGNATURE = 'skipped_invalid_signature',
  RETRY_SCHEDULED = 'retry_scheduled',
  MANUALLY_CANCELLED = 'manually_cancelled',
  MANUALLY_RETRIED = 'manually_retried',
}

@Entity('webhook_logs')
@Index(['webhookEventId', 'createdAt'])
@Index(['tenantId', 'createdAt'])
@Index(['action', 'createdAt'])
export class WebhookLog extends BaseEntity {
  @Column({
    name: 'webhook_event_id',
    type: 'uuid',
    comment: 'معرّف الـ Webhook Event',
  })
  @Index()
  webhookEventId: string;

  @ManyToOne(() => WebhookEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'webhook_event_id' })
  webhookEvent: WebhookEvent;

  @Column({
    name: 'tenant_id',
    type: 'uuid',
    nullable: true,
    comment: 'معرّف الـ Tenant',
  })
  @Index()
  tenantId?: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @Column({
    type: 'varchar',
    length: 50,
    comment: 'نوع العملية',
  })
  action: string;

  @Column({
    name: 'previous_status',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'الحالة السابقة',
  })
  previousStatus?: string;

  @Column({
    name: 'new_status',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'الحالة الجديدة',
  })
  newStatus?: string;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'رسالة توضيحية',
  })
  message?: string;

  @Column({
    name: 'error_details',
    type: 'jsonb',
    nullable: true,
    comment: 'تفاصيل الخطأ',
  })
  errorDetails?: Record<string, unknown>;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'بيانات إضافية',
  })
  metadata?: Record<string, unknown>;

  @Column({
    name: 'duration_ms',
    type: 'integer',
    nullable: true,
    comment: 'مدة العملية بالـ ms',
  })
  durationMs?: number;

  @Column({
    name: 'attempt_number',
    type: 'integer',
    default: 1,
    comment: 'رقم المحاولة',
  })
  attemptNumber: number;

  @Column({
    name: 'triggered_by',
    type: 'varchar',
    length: 255,
    default: 'system',
    comment: 'من قام بالعملية',
  })
  triggeredBy: string;
}
