/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Automation Entity                                ║
 * ║                                                                                ║
 * ║  ✅ كيان حقيقي في قاعدة البيانات بدلاً من Map في الذاكرة                       ║
 * ║  ✅ مرتبط بالمتجر (storeId) + المؤسسة (tenantId)                              ║
 * ║  ✅ يدعم triggers متعددة وactions متسلسلة                                       ║
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
import { Store } from '../../stores/entities/store.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════════

export enum AutomationStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error',
}

export enum AutomationTriggerType {
  ORDER_CREATED = 'order_created',
  ORDER_STATUS_UPDATED = 'order_status_updated',
  ORDER_SHIPPED = 'order_shipped',
  ORDER_DELIVERED = 'order_delivered',
  ORDER_CANCELLED = 'order_cancelled',
  CUSTOMER_CREATED = 'customer_created',
  CART_ABANDONED = 'cart_abandoned',
  MESSAGE_RECEIVED = 'message_received',
  SCHEDULE = 'schedule',
  MANUAL = 'manual',
}

export enum AutomationActionType {
  SEND_WHATSAPP = 'send_whatsapp',
  SEND_SMS = 'send_sms',
  SEND_EMAIL = 'send_email',
  ADD_TAG = 'add_tag',
  ASSIGN_AGENT = 'assign_agent',
  UPDATE_STATUS = 'update_status',
  DELAY = 'delay',
  WEBHOOK = 'webhook',
  SEND_TEMPLATE = 'send_template',
}

// ═══════════════════════════════════════════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export interface AutomationTrigger {
  type: string;
  conditions?: Record<string, unknown>;
}

export interface AutomationAction {
  type: string;
  config?: Record<string, unknown>;
  /** معرّف القالب إذا كان الإجراء send_template */
  templateId?: string;
  /** نص الرسالة إذا كان الإجراء send_whatsapp مباشرة */
  message?: string;
  /** مدة التأخير بالثواني إذا كان الإجراء delay */
  delaySeconds?: number;
}

export interface AutomationStats {
  triggered: number;
  successful: number;
  failed: number;
  lastTriggeredAt?: string;
  lastSuccessAt?: string;
  lastFailAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════════════════════════

@Entity('automations')
@Index(['tenantId', 'status'])
@Index(['storeId', 'status'])
@Index(['tenantId', 'storeId'])
export class Automation extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index()
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  @Index()
  storeId?: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'store_id' })
  store?: Store;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: AutomationStatus,
    default: AutomationStatus.DRAFT,
  })
  status: AutomationStatus;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'jsonb' })
  trigger: AutomationTrigger;

  @Column({ type: 'jsonb', default: [] })
  actions: AutomationAction[];

  @Column({
    type: 'jsonb',
    default: { triggered: 0, successful: 0, failed: 0 },
  })
  stats: AutomationStats;

  @Column({ name: 'execution_count', type: 'integer', default: 0 })
  executionCount: number;

  @Column({ name: 'last_executed_at', type: 'timestamptz', nullable: true })
  lastExecutedAt?: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt?: Date;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt?: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;
}
