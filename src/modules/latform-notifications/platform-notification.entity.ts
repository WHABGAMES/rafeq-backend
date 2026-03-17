/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Platform Notifications Entity                       ║
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

export enum PlatformNotificationType {
  ALERT       = 'alert',
  MAINTENANCE = 'maintenance',
  MARKETING   = 'marketing',
  CUSTOM      = 'custom',
}

export enum PlatformNotificationDisplay {
  BAR    = 'bar',
  POPUP  = 'popup',
  INLINE = 'inline',
}

export enum PlatformNotificationColor {
  BLUE   = 'blue',
  GREEN  = 'green',
  YELLOW = 'yellow',
  RED    = 'red',
  PURPLE = 'purple',
  ORANGE = 'orange',
  CUSTOM = 'custom',
}

@Entity('platform_notifications')
@Index(['isActive', 'startsAt', 'endsAt'])
export class PlatformNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Content ──────────────────────────────────────────────────────────────

  @Column({ type: 'enum', enum: PlatformNotificationType, default: PlatformNotificationType.CUSTOM })
  type: PlatformNotificationType;

  @Column({ name: 'display_type', type: 'enum', enum: PlatformNotificationDisplay, default: PlatformNotificationDisplay.BAR })
  displayType: PlatformNotificationDisplay;

  @Column({ length: 255, nullable: true })
  title?: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ nullable: true })
  link?: string;

  @Column({ name: 'link_label', nullable: true })
  linkLabel?: string;

  // ─── Design ───────────────────────────────────────────────────────────────

  @Column({ name: 'color_scheme', type: 'enum', enum: PlatformNotificationColor, default: PlatformNotificationColor.BLUE })
  colorScheme: PlatformNotificationColor;

  @Column({ name: 'bg_color', length: 50, nullable: true })
  bgColor?: string;

  @Column({ name: 'text_color', length: 50, nullable: true })
  textColor?: string;

  @Column({ length: 50, nullable: true })
  icon?: string;

  @Column({ name: 'is_scrolling', default: false })
  isScrolling: boolean;

  @Column({ name: 'is_dismissible', default: true })
  isDismissible: boolean;

  // ─── Targeting ────────────────────────────────────────────────────────────

  /**
   * فارغة = لجميع الباقات
   * ['free'] = للمجانيين فقط
   * ['free','basic'] = للمجانيين والأساسيين
   * ['pro'] = للمحترفين فقط
   */
  @Column({ name: 'target_plans', type: 'text', array: true, default: '{}' })
  targetPlans: string[];

  /**
   * فارغة = جميع الصفحات
   * ['/dashboard', '/dashboard/billing'] = صفحات محددة
   */
  @Column({ name: 'show_on_pages', type: 'text', array: true, default: '{}' })
  showOnPages: string[];

  @Column({ name: 'show_on_login', default: false })
  showOnLogin: boolean;

  // ─── Timing ───────────────────────────────────────────────────────────────

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt?: Date;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt?: Date;

  /**
   * null = عرض مرة واحدة (أو كل session)
   * 0    = عرض دائماً
   * N    = كل N ساعة
   */
  @Column({ name: 'repeat_hours', type: 'int', nullable: true })
  repeatHours?: number;

  // ─── Priority & State ─────────────────────────────────────────────────────

  @Column({ default: 0 })
  priority: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'views_count', default: 0 })
  viewsCount: number;

  @Column({ name: 'dismissals_count', default: 0 })
  dismissalsCount: number;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
