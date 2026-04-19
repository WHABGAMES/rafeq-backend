import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Admin Alert Recipient Entity                                    ║
 * ║                                                                  ║
 * ║  Table: admin_alert_recipients                                   ║
 * ║  Scope: Super-admin event notifications (WhatsApp)               ║
 * ║                                                                  ║
 * ║  Use case:                                                       ║
 * ║   • Owner adds phones to receive alerts on key platform events:  ║
 * ║     - New merchant registered                                    ║
 * ║     - Login from new device                                      ║
 * ║     - New store connected (Salla/Zid/Shopify)                    ║
 * ║     - Subscription created/cancelled                             ║
 * ║     - Multiple failed login attempts                             ║
 * ║                                                                  ║
 * ║  Flexibility:                                                    ║
 * ║   • Phones are independent of AdminUser accounts                 ║
 * ║     (owner can add external stakeholders)                        ║
 * ║   • Each recipient subscribes to a subset of events              ║
 * ║   • Can be disabled without deletion                             ║
 * ║                                                                  ║
 * ║  Isolation:                                                      ║
 * ║   • Global table — no tenantId (admin-scoped only)               ║
 * ║   • Access restricted to TEMPLATES_MANAGE permission             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
@Entity('admin_alert_recipients')
@Index(['isActive'])
export class AdminAlertRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Display name — e.g., "أبو محمد - مدير العمليات" */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /**
   * WhatsApp phone number in E.164 format — e.g., "+966500000000"
   * Unique to prevent duplicate subscriptions.
   * Note: @Column unique:true auto-creates a unique index — no explicit @Index needed.
   */
  @Column({ type: 'varchar', length: 20, unique: true })
  phone: string;

  /**
   * Array of event keys this recipient is subscribed to.
   * Keys match ALERT_EVENT_KEYS constants in admin-alerts.service.ts.
   * Empty array = subscribed to NONE (effectively paused).
   * Example: ['user.created', 'store.connected']
   */
  @Column({ name: 'subscribed_events', type: 'jsonb', default: [] })
  subscribedEvents: string[];

  /** Master switch — false = no alerts sent regardless of subscribedEvents */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Optional note for owner's reference */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string;

  /** Total alerts sent to this recipient (for analytics) */
  @Column({ name: 'sent_count', type: 'int', default: 0 })
  sentCount: number;

  /** Last successful alert timestamp */
  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt?: Date;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
