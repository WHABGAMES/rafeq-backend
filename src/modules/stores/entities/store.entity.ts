/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Store Entity                               ║
 * ║                                                                                ║
 * ║  كيان المتجر - يدعم سلة وزد                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../database/entities/base.entity';
import { Tenant } from '../../../database/entities/tenant.entity';

export enum StoreStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  DISCONNECTED = 'disconnected',
  TOKEN_EXPIRED = 'token_expired',
  SUSPENDED = 'suspended',
  UNINSTALLED = 'uninstalled',
}

export enum StorePlatform {
  SALLA = 'salla',
  ZID = 'zid',
  SHOPIFY = 'shopify',
}

@Entity('stores')
@Index(['tenantId', 'platform'])
@Index(['sallaMerchantId'], { unique: true, where: '"salla_merchant_id" IS NOT NULL' })
@Index(['zidStoreId'], { unique: true, where: '"zid_store_id" IS NOT NULL' })
@Index(['status'])
export class Store extends BaseEntity {
  @Column({
    name: 'tenant_id',
    type: 'uuid',
    comment: 'معرّف الـ Tenant المالك',
  })
  @Index()
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({
    type: 'varchar',
    length: 255,
    comment: 'اسم المتجر',
  })
  name: string;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'وصف أو ملاحظات',
  })
  description?: string;

  @Column({
    type: 'enum',
    enum: StorePlatform,
    default: StorePlatform.SALLA,
    comment: 'نوع المنصة',
  })
  platform: StorePlatform;

  @Column({
    type: 'enum',
    enum: StoreStatus,
    default: StoreStatus.PENDING,
    comment: 'حالة الربط',
  })
  status: StoreStatus;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Tokens (مشتركة)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'access_token',
    type: 'text',
    nullable: true,
    comment: 'Access Token',
  })
  @Exclude()
  accessToken?: string;

  @Column({
    name: 'refresh_token',
    type: 'text',
    nullable: true,
    comment: 'Refresh Token',
  })
  @Exclude()
  refreshToken?: string;

  @Column({
    name: 'token_expires_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ انتهاء الـ Token',
  })
  tokenExpiresAt?: Date;

  @Column({
    name: 'webhook_secret',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Secret للتحقق من Webhooks',
  })
  @Exclude()
  webhookSecret?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Salla-specific fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'salla_merchant_id',
    type: 'bigint',
    nullable: true,
    comment: 'معرّف المتجر في سلة',
  })
  sallaMerchantId?: number;

  @Column({
    name: 'salla_store_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'اسم المتجر في سلة',
  })
  sallaStoreName?: string;

  @Column({
    name: 'salla_email',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'البريد في سلة',
  })
  sallaEmail?: string;

  @Column({
    name: 'salla_mobile',
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'رقم الهاتف في سلة',
  })
  sallaMobile?: string;

  @Column({
    name: 'salla_domain',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'رابط المتجر في سلة',
  })
  sallaDomain?: string;

  @Column({
    name: 'salla_avatar',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'شعار المتجر من سلة',
  })
  sallaAvatar?: string;

  @Column({
    name: 'salla_plan',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: 'خطة الاشتراك في سلة',
  })
  sallaPlan?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Zid-specific fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'zid_store_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'معرّف المتجر في زد',
  })
  zidStoreId?: string;

  @Column({
    name: 'zid_store_uuid',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'UUID المتجر في زد',
  })
  zidStoreUuid?: string;

  @Column({
    name: 'zid_store_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'اسم المتجر في زد',
  })
  zidStoreName?: string;

  @Column({
    name: 'zid_email',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'البريد في زد',
  })
  zidEmail?: string;

  @Column({
    name: 'zid_mobile',
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'رقم الهاتف في زد',
  })
  zidMobile?: string;

  @Column({
    name: 'zid_domain',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'رابط المتجر في زد',
  })
  zidDomain?: string;

  @Column({
    name: 'zid_logo',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'شعار المتجر من زد',
  })
  zidLogo?: string;

  @Column({
    name: 'zid_currency',
    type: 'varchar',
    length: 10,
    nullable: true,
    comment: 'عملة المتجر في زد',
  })
  zidCurrency?: string;

  @Column({
    name: 'zid_language',
    type: 'varchar',
    length: 10,
    nullable: true,
    comment: 'لغة المتجر في زد',
  })
  zidLanguage?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Common fields
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'currency',
    type: 'varchar',
    length: 3,
    default: 'SAR',
    comment: 'عملة المتجر',
  })
  currency: string;

  @Column({
    type: 'jsonb',
    default: {},
    comment: 'إعدادات المتجر',
  })
  settings: Record<string, unknown>;

  @Column({
    name: 'subscribed_events',
    type: 'jsonb',
    default: [],
    comment: 'الأحداث المُشترك فيها',
  })
  subscribedEvents: string[];

  @Column({
    name: 'last_synced_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'آخر مزامنة',
  })
  lastSyncedAt?: Date;

  @Column({
    name: 'last_token_refresh_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'آخر تجديد للـ Token',
  })
  lastTokenRefreshAt?: Date;

  @Column({
    name: 'last_error',
    type: 'text',
    nullable: true,
    comment: 'آخر خطأ',
  })
  lastError?: string;

  @Column({
    name: 'last_error_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'تاريخ آخر خطأ',
  })
  lastErrorAt?: Date;

  @Column({
    name: 'consecutive_errors',
    type: 'integer',
    default: 0,
    comment: 'عدد الأخطاء المتتالية',
  })
  consecutiveErrors: number;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Computed properties
  // ═══════════════════════════════════════════════════════════════════════════════

  get isActive(): boolean {
    return this.status === StoreStatus.ACTIVE;
  }

  get isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return true;
    return new Date() > this.tokenExpiresAt;
  }

  get needsTokenRefresh(): boolean {
    if (!this.tokenExpiresAt) return true;
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);
    return this.tokenExpiresAt < tenMinutesFromNow;
  }

  get platformStoreId(): string | number | undefined {
    if (this.platform === StorePlatform.SALLA) return this.sallaMerchantId;
    if (this.platform === StorePlatform.ZID) return this.zidStoreId;
    return undefined;
  }

  get platformStoreName(): string | undefined {
    if (this.platform === StorePlatform.SALLA) return this.sallaStoreName;
    if (this.platform === StorePlatform.ZID) return this.zidStoreName;
    return this.name;
  }

  get platformLogo(): string | undefined {
    if (this.platform === StorePlatform.SALLA) return this.sallaAvatar;
    if (this.platform === StorePlatform.ZID) return this.zidLogo;
    return undefined;
  }
}
