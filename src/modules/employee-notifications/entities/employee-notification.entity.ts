/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Employee Notification Entity                         ║
 * ║                                                                                ║
 * ║  سجل التنبيهات: كل تنبيه تم إرساله لموظف                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotificationChannel } from './notification-rule.entity';

// ═══════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}

// ═══════════════════════════════════════════════════════════
// Entity
// ═══════════════════════════════════════════════════════════

@Entity('employee_notifications')
@Index(['tenantId', 'employeeId', 'isRead'])
@Index(['tenantId', 'createdAt'])
@Index(['ruleId'])
export class EmployeeNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /**
   * ID قاعدة التنبيه التي أنشأت هذا الإشعار
   */
  @Column({ type: 'uuid' })
  ruleId: string;

  /**
   * ID الموظف المستلم
   * varchar لدعم المعرفات المخصصة مثل custom-phone-xxx أو custom-email-xxx
   */
  @Column({ type: 'varchar', length: 255 })
  employeeId: string;

  /**
   * اسم الموظف (denormalized للعرض السريع)
   */
  @Column({ type: 'varchar', length: 255 })
  employeeName: string;

  /**
   * قناة الإرسال
   */
  @Column({
    type: 'enum',
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  /**
   * نوع الحدث الأصلي
   */
  @Column({ type: 'varchar', length: 100 })
  triggerEvent: string;

  /**
   * عنوان التنبيه
   */
  @Column({ type: 'varchar', length: 255 })
  title: string;

  /**
   * نص الرسالة (بعد استبدال المتغيرات)
   */
  @Column({ type: 'text' })
  message: string;

  /**
   * حالة التنبيه
   */
  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  /**
   * هل تم قراءة الإشعار؟ (للإشعارات الداخلية)
   */
  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  /**
   * تاريخ القراءة
   */
  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  /**
   * بيانات الحدث الأصلي (للسياق)
   */
  @Column({ type: 'simple-json', nullable: true })
  eventData: Record<string, unknown> | null;

  /**
   * رابط مباشر (مثل رابط الطلب)
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  actionUrl: string | null;

  /**
   * الأولوية (1=عاجل، 5=عادي)
   */
  @Column({ type: 'int', default: 3 })
  priority: number;

  /**
   * رسالة خطأ إذا فشل الإرسال
   */
  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * عدد محاولات الإرسال
   */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /**
   * ID الحدث الأصلي (webhook event)
   */
  @Column({ type: 'uuid', nullable: true })
  webhookEventId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
