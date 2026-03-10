/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Store Entity                               ║
 * ║                                                                                ║
 * ║  ✅ يدعم النمط السهل: tenantId nullable حتى يتم الربط                         ║
 * ║  ✅ يدعم سلة وزد                                                               ║
 * ║  🆕 يدعم متاجر أخرى (OTHER) عبر API                                           ║
 * ║  🔐 select: false على حقول التوكنات (لا تُحمّل تلقائياً)                       ║
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
  OTHER = 'other',  // 🆕 متاجر أخرى
}

@Entity('stores')
@Index(['tenantId', 'platform'])
@Index(['sallaMerchantId'], { unique: true, where: '"salla_merchant_id" IS NOT NULL' })
@Index(['zidStoreId'], { unique: true, where: '"zid_store_id" IS NOT NULL' })
@Index(['status'])
export class Store extends BaseEntity {
  // ✅ tenantId الآن nullable لدعم النمط السهل
  // المتجر يُنشأ أولاً، ثم يُربط بـ Tenant لاحقاً
  @Column({
    name: 'tenant_id',
    type: 'uuid',
    nullable: true,  // ✅ مهم للنمط السهل
    comment: 'معرّف الـ Tenant المالك (nullable حتى يتم الربط)',
  })
  @Index()
  tenantId?: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

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
  // 🔐 Tokens (مشتركة) - select: false لمنع التحميل التلقائي
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'access_token',
    type: 'text',
    nullable: true,
    select: false,   // 🔐 لا يُحمّل تلقائياً - يجب طلبه صراحة
    comment: 'Access Token (مشفّر بـ AES-256-GCM)',
  })
  @Exclude()
  accessToken?: string;

  @Column({
    name: 'refresh_token',
    type: 'text',
    nullable: true,
    select: false,   // 🔐 لا يُحمّل تلقائياً
    comment: 'Refresh Token (مشفّر بـ AES-256-GCM)',
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
    select: false,   // 🔐 لا يُحمّل تلقائياً
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
  // 👤 Salla Owner (Personal) — بيانات التاجر الشخصية من OAuth user/info
  //
  // ⚠️ مهم: sallaEmail هو إيميل المتجر (مثل support@salla.dev)
  //    sallaOwnerEmail هو الإيميل الشخصي للتاجر (المسجّل عليه في سلة)
  //    هذا هو الإيميل المستخدم لإنشاء الحساب وإرسال بيانات الدخول
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'salla_owner_email',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'الإيميل الشخصي لمالك المتجر (من OAuth user/info — يُستخدم لإنشاء الحساب)',
  })
  sallaOwnerEmail?: string;

  @Column({
    name: 'salla_owner_mobile',
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'رقم جوال مالك المتجر الشخصي (من OAuth user/info)',
  })
  sallaOwnerMobile?: string;

  @Column({
    name: 'salla_owner_name',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'اسم مالك المتجر الشخصي (من OAuth user/info)',
  })
  sallaOwnerName?: string;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Salla Stats (cached — updated on sync, NOT on every dashboard load)
  //
  // ✅ لماذا cached؟
  //   - منع 3 API calls لسلة في كل تحميل للداشبورد
  //   - منع 401 errors عند انتهاء التوكن من إملاء السجلات
  //   - إزالة تأخير 400ms+ عن كل GET /stores
  //   - نفس نمط Zid الذي يعمل بشكل ممتاز
  //
  // كيف تُحدَّث؟
  //   → POST /stores/:id/sync  (المستخدم يضغط "مزامنة")
  //   → عند ربط المتجر لأول مرة (connectSallaStore)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'salla_orders_count',
    type: 'integer',
    default: 0,
    nullable: true,
    comment: 'عدد الطلبات في سلة (مخزّن محلياً — يُحدَّث عند المزامنة)',
  })
  sallaOrdersCount?: number;

  @Column({
    name: 'salla_products_count',
    type: 'integer',
    default: 0,
    nullable: true,
    comment: 'عدد المنتجات في سلة (مخزّن محلياً — يُحدَّث عند المزامنة)',
  })
  sallaProductsCount?: number;

  @Column({
    name: 'salla_customers_count',
    type: 'integer',
    default: 0,
    nullable: true,
    comment: 'عدد العملاء في سلة (مخزّن محلياً — يُحدَّث عند المزامنة)',
  })
  sallaCustomersCount?: number;

  @Column({
    name: 'salla_last_sync_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'آخر مزامنة لإحصائيات سلة',
  })
  sallaLastSyncAt?: Date;

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
  // 📊 Zid Stats (cached — updated on sync)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'zid_orders_count',
    type: 'integer',
    default: 0,
    nullable: true,
    comment: 'عدد الطلبات في زد (مخزّن محلياً)',
  })
  zidOrdersCount?: number;

  @Column({
    name: 'zid_products_count',
    type: 'integer',
    default: 0,
    nullable: true,
    comment: 'عدد المنتجات في زد (مخزّن محلياً)',
  })
  zidProductsCount?: number;

  @Column({
    name: 'zid_customers_count',
    type: 'integer',
    default: 0,
    nullable: true,
    comment: 'عدد العملاء في زد (مخزّن محلياً)',
  })
  zidCustomersCount?: number;

  @Column({
    name: 'zid_last_sync_at',
    type: 'timestamptz',
    nullable: true,
    comment: 'آخر مزامنة لإحصائيات زد',
  })
  zidLastSyncAt?: Date;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 Other Platform fields (Generic)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Column({
    name: 'other_platform_name',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'اسم المنصة (مثل: Shopify, WooCommerce, OpenCart...)',
  })
  otherPlatformName?: string;

  @Column({
    name: 'other_api_base_url',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'رابط API الأساسي للمنصة',
  })
  otherApiBaseUrl?: string;

  @Column({
    name: 'other_store_url',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'رابط المتجر الخارجي',
  })
  otherStoreUrl?: string;

  @Column({
    name: 'other_store_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'معرّف المتجر في المنصة الخارجية',
  })
  otherStoreId?: string;

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

  get isLinked(): boolean {
    return !!this.tenantId;
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
    if (this.platform === StorePlatform.OTHER) return this.otherStoreId;
    return undefined;
  }

  get platformStoreName(): string | undefined {
    if (this.platform === StorePlatform.SALLA) return this.sallaStoreName;
    if (this.platform === StorePlatform.ZID) return this.zidStoreName;
    if (this.platform === StorePlatform.OTHER) return this.otherPlatformName;
    return this.name;
  }

  get platformLogo(): string | undefined {
    if (this.platform === StorePlatform.SALLA) return this.sallaAvatar;
    if (this.platform === StorePlatform.ZID) return this.zidLogo;
    return undefined;
  }
}
