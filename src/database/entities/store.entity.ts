/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Store Entity                               ║
 * ║                                                                                ║
 * ║  📌 الـ Store = متجر سلة المربوط                                                 ║
 * ║                                                                                ║
 * ║  كل Tenant يمكن أن يربط متجر سلة واحد أو أكثر                                   ║
 * ║  يحتوي على tokens للـ OAuth و webhook settings                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

/**
 * 📌 حالة المتجر
 */
export enum StoreStatus {
  ACTIVE = 'active',           // متصل ويعمل
  INACTIVE = 'inactive',       // غير نشط
  DISCONNECTED = 'disconnected', // تم قطع الاتصال
  PENDING = 'pending',         // في انتظار التفعيل
  ERROR = 'error',             // خطأ في الاتصال
}

@Entity('stores')
export class Store extends BaseEntity {
  /**
   * 🏢 الـ Tenant
   */
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_store_tenant')
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /**
   * 🔑 Salla Store ID
   */
  @Column({
    name: 'salla_store_id',
    type: 'varchar',
    length: 100,
    unique: true,
  })
  @Index('idx_store_salla_id')
  sallaStoreId: string;

  /**
   * 🏷️ اسم المتجر في سلة
   */
  @Column({
    type: 'varchar',
    length: 255,
  })
  name: string;

  /**
   * 📧 بريد المتجر
   */
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  email?: string;

  /**
   * 🌐 رابط المتجر في سلة
   */
  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  domain?: string;

  /**
   * 📊 الحالة
   */
  @Column({
    type: 'enum',
    enum: StoreStatus,
    default: StoreStatus.PENDING,
  })
  @Index('idx_store_status')
  status: StoreStatus;

  /**
   * 🔐 Access Token (مشفر)
   */
  @Column({
    name: 'access_token',
    type: 'text',
    nullable: true,
    select: false, // لا يُرجع في الـ queries العادية
  })
  accessToken?: string;

  /**
   * 🔄 Refresh Token (مشفر)
   */
  @Column({
    name: 'refresh_token',
    type: 'text',
    nullable: true,
    select: false,
  })
  refreshToken?: string;

  /**
   * 📅 تاريخ انتهاء الـ Token
   */
  @Column({
    name: 'token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  tokenExpiresAt?: Date;

  /**
   * 🔑 Webhook Secret
   * مفتاح سري للتحقق من صحة الـ webhooks
   */
  @Column({
    name: 'webhook_secret',
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
  })
  webhookSecret?: string;

  /**
   * 📡 الـ Webhooks المفعّلة
   * 
   * مثال:
   * [
   *   "order.created",
   *   "order.paid",
   *   "customer.created",
   *   "shipment.tracking.updated"
   * ]
   */
  @Column({
    name: 'enabled_webhooks',
    type: 'jsonb',
    nullable: true,
    default: [],
  })
  enabledWebhooks: string[];

  /**
   * ⚙️ إعدادات المزامنة
   * 
   * {
   *   "syncOrders": true,
   *   "syncCustomers": true,
   *   "syncProducts": false,
   *   "ordersSyncDays": 30
   * }
   */
  @Column({
    name: 'sync_settings',
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  syncSettings: Record<string, unknown>;

  /**
   * 📅 تاريخ آخر مزامنة
   */
  @Column({
    name: 'last_sync_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastSyncAt?: Date;

  /**
   * 📊 إحصائيات المتجر
   * 
   * {
   *   "ordersCount": 1500,
   *   "customersCount": 800,
   *   "webhooksReceived": 5000
   * }
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  stats: Record<string, number>;

  /**
   * 📝 بيانات إضافية من سلة
   */
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {},
  })
  metadata: Record<string, unknown>;
}
