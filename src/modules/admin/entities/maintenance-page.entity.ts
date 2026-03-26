/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           Rafeq Platform — Maintenance Page Entity                            ║
 * ║                                                                                ║
 * ║  📌 وضع الصيانة الجزئي — يتحكم بكل صفحة على حدة                                ║
 * ║  يسمح للأدمن بتعطيل صفحات محددة بدون التأثير على كامل المنصة                    ║
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

export enum MaintenanceStyle {
  OVERLAY = 'overlay',       // Overlay خفيف مع animation
  BLUR = 'blur',             // Blur + رسالة
  FULL_LOCK = 'full_lock',   // قفل كامل مع صفحة بديلة
}

@Entity('maintenance_pages')
@Index(['route'], { unique: true })
export class MaintenancePage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, comment: 'مسار الصفحة مثل /dashboard/conversion-elements' })
  route: string;

  @Column({ type: 'varchar', length: 255, comment: 'اسم الصفحة للعرض' })
  label: string;

  @Column({ name: 'is_active', type: 'boolean', default: false, comment: 'هل الصفحة تحت الصيانة' })
  isActive: boolean;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'overlay',
    comment: 'نوع عرض الصيانة: overlay | blur | full_lock',
  })
  style: MaintenanceStyle;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: 'رسالة مخصصة للتاجر' })
  message?: string;

  @Column({ name: 'activated_by', type: 'varchar', length: 255, nullable: true, comment: 'الأدمن الذي فعّل الصيانة' })
  activatedBy?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
