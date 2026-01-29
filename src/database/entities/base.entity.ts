/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Base Entity                                ║
 * ║                                                                                ║
 * ║  📌 كل الـ Entities ترث من هذا الـ class                                        ║
 * ║  يحتوي على الحقول المشتركة: id, timestamps, soft delete                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  BaseEntity as TypeOrmBaseEntity,
} from 'typeorm';

/**
 * 📌 شرح Decorators:
 * 
 * @PrimaryGeneratedColumn('uuid') → عمود ID فريد من نوع UUID
 * @CreateDateColumn() → يُملأ تلقائياً بتاريخ الإنشاء
 * @UpdateDateColumn() → يُحدّث تلقائياً عند أي تعديل
 * @DeleteDateColumn() → للـ Soft Delete (لا يُحذف فعلياً)
 */

export abstract class BaseEntity extends TypeOrmBaseEntity {
  /**
   * 🔑 ID - المعرّف الفريد
   * 
   * نستخدم UUID لأنه:
   * - أكثر أماناً من auto-increment
   * - يعمل مع distributed systems
   * - لا يكشف عدد السجلات
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 📅 تاريخ الإنشاء
   */
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt: Date;

  /**
   * 📅 تاريخ آخر تحديث
   */
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt: Date;

  /**
   * 🗑️ تاريخ الحذف (Soft Delete)
   * 
   * Soft Delete = لا نحذف السجل، فقط نضع تاريخ
   * فائدته:
   * - يمكن استعادة البيانات
   * - يحافظ على العلاقات
   * - مطلوب للـ audit trail
   */
  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'timestamptz',
    nullable: true,
  })
  deletedAt?: Date;
}
