/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Customer Entity                            ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Entity يمثل عملاء المتاجر                                           ║
 * ║  كل عميل (Customer) ينتمي لمتجر (Store) واحد                                   ║
 * ║  العملاء يأتون من منصة سلة أو زد عبر الـ Webhooks                              ║
 * ║  ✅ v4: إضافة zidCustomerId + جعل sallaCustomerId nullable                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
// ✅ تم تصحيح المسار - يشير مباشرة للـ Store entity الجديد
import { Store } from '../../modules/stores/entities/store.entity';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                         🏷️ TYPES & INTERFACES                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

export enum CustomerGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum CustomerStatus {
  ACTIVE = 'active',
  BLOCKED = 'blocked',
  UNSUBSCRIBED = 'unsubscribed',
}

export interface CustomerAddress {
  city?: string;
  district?: string;
  street?: string;
  building?: string;
  apartment?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface CustomerMetadata {
  source?: string;
  firstOrderDate?: string;
  lastOrderDate?: string;
  averageOrderValue?: number;
  totalSpent?: number;
  cancelledOrdersCount?: number;
  notes?: string;
  tags?: string[];
  customFields?: Record<string, any>;
  sallaData?: Record<string, any>;
  zidData?: Record<string, any>;     // ✅ v4: بيانات زد الخام
}

/**
 * ✅ v4: الفهارس الفريدة أصبحت مشروطة (conditional)
 * لأن كل عميل قد يكون من سلة أو من زد — لكن ليس من كليهما
 *
 * ⚠️ ملاحظة: TypeORM لا يدعم where في @Index decorator بشكل كامل لجميع الحالات.
 * الفهارس المشروطة تُنشأ عبر الـ Migration ولا تُدار بواسطة TypeORM sync.
 * الـ decorator هنا توثيقي فقط — الفهارس الفعلية في:
 * migrations/AddZidPlatformSupport1707753600000.ts
 */
@Entity('customers')
@Index(['storeId', 'phone'])
@Index(['storeId', 'email'])
@Index(['storeId', 'status'])
@Index(['tenantId'])
export class Customer extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string;

  @Column({ name: 'store_id', type: 'uuid' })
  storeId: string;

  /**
   * ✅ v4: أصبح nullable — العميل قد يكون من زد وليس من سلة
   * الفهرس الفريد المشروط: IDX_customers_store_salla_customer
   */
  @Column({
    name: 'salla_customer_id',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'معرف العميل في منصة سلة (nullable — قد يكون عميل زد)',
  })
  sallaCustomerId?: string;

  /**
   * ✅ v4: معرف العميل في منصة زد
   * الفهرس الفريد المشروط: IDX_customers_store_zid_customer
   */
  @Column({
    name: 'zid_customer_id',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'معرف العميل في منصة زد',
  })
  zidCustomerId?: string;

  @Column({
    name: 'first_name',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'الاسم الأول للعميل',
  })
  firstName?: string;

  @Column({
    name: 'last_name',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'اسم العائلة',
  })
  lastName?: string;

  @Column({
    name: 'full_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'الاسم الكامل',
  })
  fullName?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'البريد الإلكتروني',
  })
  email?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'رقم الهاتف بالصيغة الدولية',
  })
  phone?: string;

  @Column({
    type: 'enum',
    enum: CustomerGender,
    nullable: true,
    comment: 'جنس العميل',
  })
  gender?: CustomerGender;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
    default: 'ar',
    comment: 'لغة العميل المفضلة',
  })
  locale?: string;

  @Column({
    name: 'avatar_url',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'رابط صورة العميل',
  })
  avatarUrl?: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'العنوان الكامل',
  })
  address?: CustomerAddress;

  @Column({
    type: 'enum',
    enum: CustomerStatus,
    default: CustomerStatus.ACTIVE,
    comment: 'حالة العميل',
  })
  status: CustomerStatus;

  @Column({
    name: 'total_orders',
    type: 'integer',
    default: 0,
    comment: 'إجمالي عدد الطلبات',
  })
  totalOrders: number;

  @Column({
    name: 'total_spent',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    comment: 'إجمالي المبلغ المدفوع',
  })
  totalSpent: number;

  @Column({
    type: 'varchar',
    length: 5,
    default: 'SAR',
    comment: 'العملة',
  })
  currency: string;

  @Column({
    name: 'first_seen_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ أول ظهور للعميل',
  })
  firstSeenAt?: Date;

  @Column({
    name: 'last_order_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ آخر طلب',
  })
  lastOrderAt?: Date;

  @Column({
    name: 'last_contact_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ آخر تواصل',
  })
  lastContactAt?: Date;

  @Column({
    name: 'marketing_consent',
    type: 'boolean',
    default: false,
    comment: 'موافقة على الرسائل التسويقية',
  })
  marketingConsent: boolean;

  @Column({
    name: 'marketing_consent_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ الموافقة على التسويق',
  })
  marketingConsentAt?: Date;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: [],
    comment: 'وسوم العميل للتصنيف',
  })
  tags: string[];

  @Column({
    type: 'jsonb',
    nullable: true,
    default: [],
    comment: 'الشرائح التي ينتمي لها العميل',
  })
  segments: string[];

  @Column({
    name: 'is_blocked',
    type: 'boolean',
    default: false,
    comment: 'هل العميل محظور',
  })
  isBlocked: boolean;

  @Column({
    name: 'block_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'سبب الحظر',
  })
  blockReason?: string;

  @Column({
    name: 'blocked_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ الحظر',
  })
  blockedAt?: Date;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'القناة الأساسية للتواصل',
  })
  channel?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'الاسم للبحث السريع',
  })
  name?: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
    comment: 'بيانات إضافية مرنة',
  })
  metadata: CustomerMetadata;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store: Store;
}
