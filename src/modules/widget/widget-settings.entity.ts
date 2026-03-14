/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Widget Settings Entity                           ║
 * ║                                                                                ║
 * ║  إعدادات ويدجت واتساب لكل متجر                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WidgetPosition {
  BOTTOM_RIGHT = 'bottom-right',
  BOTTOM_LEFT = 'bottom-left',
}

export enum WidgetSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

@Entity('widget_settings')
@Index(['storeId'], { unique: true })
export class WidgetSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // ─── Toggle ───────────────────────────────────
  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  // ─── WhatsApp Number ──────────────────────────
  @Column({ name: 'whatsapp_number', type: 'varchar', length: 20 })
  whatsappNumber: string;

  // ─── Welcome Message ──────────────────────────
  @Column({ name: 'welcome_message', type: 'varchar', length: 500, default: 'مرحباً! كيف نقدر نساعدك؟ 👋' })
  welcomeMessage: string;

  // ─── Pre-filled Message ───────────────────────
  @Column({ name: 'prefilled_message', type: 'varchar', length: 300, default: 'مرحبا، أحتاج مساعدة بخصوص طلبي' })
  prefilledMessage: string;

  // ─── Appearance ───────────────────────────────
  @Column({ name: 'position', type: 'enum', enum: WidgetPosition, default: WidgetPosition.BOTTOM_RIGHT })
  position: WidgetPosition;

  @Column({ name: 'button_color', type: 'varchar', length: 7, default: '#25D366' })
  buttonColor: string;

  @Column({ name: 'header_color', type: 'varchar', length: 7, default: '#075E54' })
  headerColor: string;

  @Column({ name: 'size', type: 'enum', enum: WidgetSize, default: WidgetSize.MEDIUM })
  size: WidgetSize;

  @Column({ name: 'show_on_mobile', type: 'boolean', default: true })
  showOnMobile: boolean;

  @Column({ name: 'show_tooltip', type: 'boolean', default: true })
  showTooltip: boolean;

  @Column({ name: 'tooltip_text', type: 'varchar', length: 100, default: 'تحتاج مساعدة؟' })
  tooltipText: string;

  // ─── Display Name ─────────────────────────────
  @Column({ name: 'agent_name', type: 'varchar', length: 100, default: 'فريق الدعم' })
  agentName: string;

  @Column({ name: 'agent_avatar_url', type: 'varchar', length: 500, nullable: true })
  agentAvatarUrl: string;

  // ─── Schedule ─────────────────────────────────
  @Column({ name: 'offline_message', type: 'varchar', length: 300, nullable: true })
  offlineMessage: string;

  // ─── Analytics ────────────────────────────────
  @Column({ name: 'total_clicks', type: 'integer', default: 0 })
  totalClicks: number;

  @Column({ name: 'total_impressions', type: 'integer', default: 0 })
  totalImpressions: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
