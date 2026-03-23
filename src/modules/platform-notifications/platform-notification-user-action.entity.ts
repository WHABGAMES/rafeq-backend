/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  جدول يتتبع حالة كل تاجر مع كل إشعار (شاف / أغلق)                           ║
 * ║  يحل مشكلة: الإشعار يظهر باستمرار + المشاهدات تتكرر                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('platform_notification_user_actions')
@Unique('uq_notif_user_action', ['notificationId', 'userId', 'action'])
@Index(['userId'])
@Index(['notificationId'])
export class PlatformNotificationUserAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'notification_id', type: 'uuid' })
  notificationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  action: 'viewed' | 'dismissed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
