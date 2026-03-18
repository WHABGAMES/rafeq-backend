/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Element Event Entity                                 ║
 * ║                                                                                ║
 * ║  High-volume tracking table for all element interactions.                     ║
 * ║  Designed for:                                                                 ║
 * ║  - Append-only writes (no updates)                                            ║
 * ║  - Time-series queries                                                         ║
 * ║  - Aggregation into daily/hourly rollups                                      ║
 * ║                                                                                ║
 * ║  ⚠️ SCALE: This table will grow FAST.                                         ║
 * ║  → Partition by month on created_at                                           ║
 * ║  → Archive events older than 90 days                                          ║
 * ║  → Use materialized views for analytics                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ElementEventType {
  VIEW            = 'element_view',
  CLICK           = 'element_click',
  CLOSE           = 'element_close',
  SUBMIT          = 'element_submit',        // form submit, email capture
  SPIN            = 'element_spin',          // spin wheel
  COUPON_COPY     = 'element_coupon_copy',
  ADD_TO_CART     = 'element_add_to_cart',
  PURCHASE        = 'purchase_from_element',
  HOVER           = 'element_hover',
  SCROLL_INTO     = 'element_scroll_into',
  CTA_CLICK       = 'element_cta_click',     // WhatsApp CTA, link click
}

@Entity('element_events')
@Index(['storeId', 'createdAt'])
@Index(['elementId', 'createdAt'])
@Index(['storeId', 'eventType', 'createdAt'])
@Index(['sessionId'])
export class ElementEvent {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'element_id', type: 'uuid' })
  elementId: string;

  // ─── Event Data ───────────────────────────────────────────────
  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 50,
  })
  eventType: ElementEventType;

  // ─── Session & User ───────────────────────────────────────────
  @Column({ name: 'session_id', type: 'varchar', length: 100 })
  sessionId: string;

  @Column({ name: 'visitor_id', type: 'varchar', length: 100, nullable: true })
  visitorId?: string;            // persistent cookie ID

  @Column({ name: 'customer_id', type: 'varchar', length: 100, nullable: true })
  customerId?: string;           // logged-in customer

  // ─── Context ──────────────────────────────────────────────────
  @Column({ name: 'page_url', type: 'text', nullable: true })
  pageUrl?: string;

  @Column({ name: 'page_type', type: 'varchar', length: 50, nullable: true })
  pageType?: string;             // 'product', 'cart', 'home', 'category'

  @Column({ name: 'product_id', type: 'varchar', length: 100, nullable: true })
  productId?: string;

  @Column({ name: 'cart_value', type: 'decimal', precision: 12, scale: 2, nullable: true })
  cartValue?: number;

  @Column({ name: 'cart_items', type: 'integer', nullable: true })
  cartItems?: number;

  // ─── Revenue Attribution ──────────────────────────────────────
  @Column({ name: 'order_id', type: 'varchar', length: 100, nullable: true })
  orderId?: string;

  @Column({ name: 'order_value', type: 'decimal', precision: 12, scale: 2, nullable: true })
  orderValue?: number;

  // ─── Device & Source ──────────────────────────────────────────
  @Column({ name: 'device_type', type: 'varchar', length: 20, nullable: true })
  deviceType?: string;            // 'mobile', 'desktop', 'tablet'

  @Column({ name: 'country', type: 'varchar', length: 5, nullable: true })
  country?: string;

  @Column({ name: 'utm_source', type: 'varchar', length: 100, nullable: true })
  utmSource?: string;

  @Column({ name: 'utm_medium', type: 'varchar', length: 100, nullable: true })
  utmMedium?: string;

  @Column({ name: 'utm_campaign', type: 'varchar', length: 100, nullable: true })
  utmCampaign?: string;

  // ─── A/B Test Variant ─────────────────────────────────────────
  @Column({ name: 'variant_label', type: 'varchar', length: 10, nullable: true })
  variantLabel?: string;

  // ─── Extra metadata ───────────────────────────────────────────
  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
