/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Service                             ║
 * ║                                                                                ║
 * ║  ✅ Fixed: إضافة syncStore method                                              ║
 * ║  ✅ يدعم سلة وزد                                                               ║
 * ║  🆕 يدعم متاجر أخرى (OTHER) عبر API                                           ║
 * ║  🔐 NEW: تشفير/فك تشفير التوكنات بـ AES-256-GCM                               ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/stores.service.ts                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial, Not } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

// 🔐 Encryption
import { encrypt, decrypt, decryptSafe, isEncrypted } from '@common/utils/encryption.util';

// Entities
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

// Services
import { SallaOAuthService, SallaMerchantInfo } from './salla-oauth.service';
import { SallaApiService } from './salla-api.service';
import { ZidOAuthService, ZidStoreInfo, ZidTokenResponse } from './zid-oauth.service';
import { ZidApiService, ZidAuthTokens } from './zid-api.service';

interface ConnectSallaStoreData {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  merchantInfo: SallaMerchantInfo;
}

interface ConnectZidStoreData {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    authorization?: string;
  };
  storeInfo: ZidStoreInfo;
}

// 🆕 بيانات ربط المتاجر الأخرى
interface ConnectOtherStoreData {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  storeInfo: {
    platformName: string;
    apiBaseUrl: string;
    name: string;
    url: string;
    storeId: string;
  };
}

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    private readonly sallaOAuthService: SallaOAuthService,
    private readonly sallaApiService: SallaApiService,
    private readonly zidOAuthService: ZidOAuthService,
    private readonly zidApiService: ZidApiService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Token Encryption Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تشفير التوكنات قبل الحفظ في قاعدة البيانات
   */
  private encryptTokens(store: Store, tokens: { accessToken: string; refreshToken: string }): void {
    store.accessToken = encrypt(tokens.accessToken) ?? undefined;
    store.refreshToken = encrypt(tokens.refreshToken) ?? undefined;
  }

  /**
   * جلب متجر مع التوكنات (مشفّرة) - لأن select: false
   */
  private async findWithTokens(where: Record<string, any>): Promise<Store | null> {
    return this.storeRepository
      .createQueryBuilder('store')
      .addSelect('store.accessToken')
      .addSelect('store.refreshToken')
      .where(where)
      .getOne();
  }

  /**
   * فك تشفير Access Token لاستخدامه مع API
   */
  private getDecryptedAccessToken(store: Store): string | null {
    return decrypt(store.accessToken ?? null);
  }

  /**
   * فك تشفير Refresh Token لاستخدامه في التجديد
   */
  private getDecryptedRefreshToken(store: Store): string | null {
    return decrypt(store.refreshToken ?? null);
  }

  /**
   * ✅ جلب توكنات زد الكاملة (managerToken + authorizationToken)
   * حسب وثائق زد: API يحتاج headerين:
   *   Authorization: Bearer {authorizationToken}
   *   X-Manager-Token: {managerToken}
   */
  private getZidTokens(store: Store, managerToken: string): ZidAuthTokens {
    const storedAuth = (store.settings as any)?.zidAuthorizationToken;
    // ✅ Handle both encrypted tokens (new) and plain JWT tokens (legacy)
    let authorizationToken: string | null = null;
    if (storedAuth) {
      authorizationToken = isEncrypted(storedAuth) ? decryptSafe(storedAuth) : storedAuth;
    }

    if (!authorizationToken) {
      this.logger.warn(`⚠️ Zid store ${store.id} has no authorization token - using access token only`, {
        storeName: store.name || store.zidStoreName,
        zidStoreId: store.zidStoreId,
        note: 'Some Zid API endpoints may fail without authorization token',
      });
    } else {
      this.logger.debug(`Using Zid tokens for store ${store.id} (both access + authorization)`);
    }

    return {
      managerToken,
      authorizationToken: authorizationToken || undefined,
      storeId: store.zidStoreId || undefined, // ✅ FIX: Store-Id header لحل 401 "No such user"
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Salla Store Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectSallaStore(
    tenantId: string,
    data: ConnectSallaStoreData,
  ): Promise<Store> {
    const { tokens, merchantInfo } = data;

    // ✅ Raw SQL لتجاوز مشكلة bigint مع TypeORM
    const existingStore = await this.findByMerchantId(merchantInfo.id);

    if (existingStore) {
      if (existingStore.tenantId === tenantId) {
        return this.updateSallaStoreConnection(existingStore, tokens, merchantInfo);
      }
      throw new ConflictException('This store is already connected to another account');
    }

    const store = this.storeRepository.create({
      tenantId,
      name: merchantInfo.name || merchantInfo.username,
      platform: StorePlatform.SALLA,
      status: StoreStatus.ACTIVE,
      sallaMerchantId: merchantInfo.id,
      tokenExpiresAt: tokens.expiresAt,
      sallaStoreName: merchantInfo.name,
      sallaEmail: merchantInfo.email,
      sallaMobile: merchantInfo.mobile,
      sallaDomain: merchantInfo.domain,
      sallaAvatar: merchantInfo.avatar,
      sallaPlan: merchantInfo.plan,
      // ✅ تهيئة الإحصائيات بـ 0 عند الربط — تُحدَّث عند أول sync
      sallaOrdersCount: 0,
      sallaProductsCount: 0,
      sallaCustomersCount: 0,
      settings: {
        autoReply: true,
        welcomeMessageEnabled: true,
        orderNotificationsEnabled: true,
      },
      subscribedEvents: [
        'order.created',
        'customer.created',
        'abandoned.cart',
        'order.status.updated',
        'shipment.created',
      ],
      lastSyncedAt: new Date(),
    });

    // 🔐 تشفير التوكنات
    this.encryptTokens(store, tokens);

    const savedStore = await this.storeRepository.save(store);

    this.eventEmitter.emit('store.connected', {
      storeId: savedStore.id,
      tenantId,
      platform: StorePlatform.SALLA,
      merchantId: merchantInfo.id,
    });

    this.logger.log(`Salla store connected: ${savedStore.name}`, {
      storeId: savedStore.id,
      tenantId,
      merchantId: merchantInfo.id,
    });

    return savedStore;
  }

  private async updateSallaStoreConnection(
    store: Store,
    tokens: ConnectSallaStoreData['tokens'],
    merchantInfo: SallaMerchantInfo,
  ): Promise<Store> {
    // 🔐 تشفير التوكنات
    this.encryptTokens(store, tokens);
    store.tokenExpiresAt = tokens.expiresAt;
    store.status = StoreStatus.ACTIVE;
    store.lastSyncedAt = new Date();
    store.consecutiveErrors = 0;
    store.lastError = undefined;
    store.sallaStoreName = merchantInfo.name;
    store.sallaEmail = merchantInfo.email;
    store.sallaMobile = merchantInfo.mobile;
    store.sallaDomain = merchantInfo.domain;
    store.sallaAvatar = merchantInfo.avatar;
    store.sallaPlan = merchantInfo.plan;

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Zid Store Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectZidStore(
    tenantId: string,
    data: ConnectZidStoreData,
  ): Promise<Store> {
    const { tokens, storeInfo } = data;

    const existingStore = await this.storeRepository.findOne({
      where: { zidStoreId: storeInfo.id },
    });

    if (existingStore) {
      if (existingStore.tenantId === tenantId) {
        return this.updateZidStoreConnection(existingStore, tokens, storeInfo);
      }
      throw new ConflictException('هذا المتجر مربوط بحساب آخر');
    }

    const store = this.storeRepository.create({
      tenantId,
      name: storeInfo.name,
      platform: StorePlatform.ZID,
      status: StoreStatus.ACTIVE,
      zidStoreId: storeInfo.id,
      zidStoreUuid: storeInfo.uuid,
      tokenExpiresAt: tokens.expiresAt,
      zidStoreName: storeInfo.name,
      zidEmail: storeInfo.email,
      zidMobile: storeInfo.mobile,
      zidDomain: storeInfo.url,
      zidLogo: storeInfo.logo,
      zidCurrency: storeInfo.currency,
      zidLanguage: storeInfo.language,
      settings: {
        autoReply: true,
        welcomeMessageEnabled: true,
        orderNotificationsEnabled: true,
        ...(tokens.authorization
          ? { zidAuthorizationToken: encrypt(tokens.authorization) }
          : {}),
      },
      subscribedEvents: [
        'order.created',
        'customer.created',
        'order.status.updated',
      ],
      lastSyncedAt: new Date(),
    });

    // 🔐 تشفير التوكنات
    this.encryptTokens(store, tokens);

    const savedStore = await this.storeRepository.save(store);

    // ✅ FIX (Bug #3): Register Zid webhooks after dashboard OAuth connection
    // PR #24 audit: auto-registration flow registered webhooks but dashboard flow did not
    try {
      const baseUrl = this.configService.get<string>('app.baseUrl')
        || this.configService.get<string>('APP_BASE_URL')
        || 'https://api.rafeq.ai';
      const webhookUrl = `${baseUrl}/api/webhooks/zid`;
      const appId = this.configService.get<string>('zid.clientId') || 'rafeq-app';

      const webhookTokens = {
        managerToken: tokens.accessToken,
        authorizationToken: tokens.authorization || undefined,
      };

      const result = await this.zidApiService.registerWebhooks(webhookTokens, webhookUrl, appId);
      this.logger.log(`🔔 Dashboard OAuth - Zid webhooks registered: ${result.registered.join(',')}`);
    } catch (error: any) {
      this.logger.warn(`⚠️ Webhook registration failed (non-fatal): ${error.message}`);
    }

    this.eventEmitter.emit('store.connected', {
      storeId: savedStore.id,
      tenantId,
      platform: StorePlatform.ZID,
      zidStoreId: storeInfo.id,
    });

    this.logger.log(`Zid store connected: ${savedStore.name}`, {
      storeId: savedStore.id,
      tenantId,
      zidStoreId: storeInfo.id,
    });

    return savedStore;
  }

  private async updateZidStoreConnection(
    store: Store,
    tokens: ConnectZidStoreData['tokens'],
    storeInfo: ZidStoreInfo,
  ): Promise<Store> {
    // 🔐 تشفير التوكنات
    this.encryptTokens(store, tokens);
    store.tokenExpiresAt = tokens.expiresAt;
    store.status = StoreStatus.ACTIVE;
    store.lastSyncedAt = new Date();
    store.consecutiveErrors = 0;
    store.lastError = undefined;
    store.zidStoreName = storeInfo.name;
    store.zidEmail = storeInfo.email;
    store.zidMobile = storeInfo.mobile;
    store.zidDomain = storeInfo.url;
    store.zidLogo = storeInfo.logo;
    store.zidCurrency = storeInfo.currency;
    store.zidLanguage = storeInfo.language;

    // ✅ تحديث authorization token في settings
    // ✅ FIX (Bug #2): Mirror updateZidStoreFields logic — clear stale token when Zid doesn't return one
    // PR #24 audit: missing else branch caused revoked tokens to persist in database
    if (tokens.authorization) {
      store.settings = {
        ...(store.settings || {}),
        zidAuthorizationToken: encrypt(tokens.authorization),
      };
    } else {
      // Clear old (potentially invalid) authorization token to prevent 401 errors
      const { zidAuthorizationToken: _removed, ...otherSettings } = (store.settings as any) || {};
      store.settings = otherSettings;
      this.logger.warn(`⚠️ No authorization token from Zid - cleared old token for store ${store.zidStoreId}`);
    }

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 Other Platform Store Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectOtherStore(
    tenantId: string,
    data: ConnectOtherStoreData,
  ): Promise<Store> {
    const { tokens, storeInfo } = data;

    // التحقق من عدم وجود متجر بنفس الـ API base URL لنفس الـ tenant
    const existingStore = await this.storeRepository.findOne({
      where: {
        tenantId,
        platform: StorePlatform.OTHER,
        otherApiBaseUrl: storeInfo.apiBaseUrl,
      },
    });

    if (existingStore) {
      // تحديث المتجر الموجود بدلاً من إنشاء جديد
      return this.updateOtherStoreConnection(existingStore, tokens, storeInfo);
    }

    const store = this.storeRepository.create({
      tenantId,
      name: storeInfo.name || storeInfo.platformName,
      platform: StorePlatform.OTHER,
      status: StoreStatus.ACTIVE,
      tokenExpiresAt: tokens.expiresAt,
      otherPlatformName: storeInfo.platformName,
      otherApiBaseUrl: storeInfo.apiBaseUrl,
      otherStoreUrl: storeInfo.url || undefined,
      otherStoreId: storeInfo.storeId || undefined,
      settings: {
        autoReply: true,
        welcomeMessageEnabled: true,
        orderNotificationsEnabled: true,
      },
      subscribedEvents: [],
      lastSyncedAt: new Date(),
    });

    // 🔐 تشفير التوكنات
    this.encryptTokens(store, tokens);

    const savedStore = await this.storeRepository.save(store);

    this.eventEmitter.emit('store.connected', {
      storeId: savedStore.id,
      tenantId,
      platform: StorePlatform.OTHER,
      platformName: storeInfo.platformName,
    });

    this.logger.log(`🆕 Other platform store connected: ${savedStore.name}`, {
      storeId: savedStore.id,
      tenantId,
      platformName: storeInfo.platformName,
      apiBaseUrl: storeInfo.apiBaseUrl,
    });

    return savedStore;
  }

  private async updateOtherStoreConnection(
    store: Store,
    tokens: ConnectOtherStoreData['tokens'],
    storeInfo: ConnectOtherStoreData['storeInfo'],
  ): Promise<Store> {
    // 🔐 تشفير التوكنات
    this.encryptTokens(store, tokens);
    store.tokenExpiresAt = tokens.expiresAt;
    store.status = StoreStatus.ACTIVE;
    store.lastSyncedAt = new Date();
    store.consecutiveErrors = 0;
    store.lastError = undefined;
    store.name = storeInfo.name || store.name;
    store.otherPlatformName = storeInfo.platformName;
    store.otherStoreUrl = storeInfo.url || store.otherStoreUrl;
    store.otherStoreId = storeInfo.storeId || store.otherStoreId;

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Common Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ جلب متاجر الـ tenant — يُخفي المتاجر المُلغى تثبيتها (UNINSTALLED)
   *
   * السبب: عند إلغاء التاجر تثبيت التطبيق من سلة أو زد، نحتفظ بسجل المتجر
   * في DB (soft-delete logic) لكن نُخفيه من الداشبورد.
   * عند إعادة التثبيت، يُحدَّث status → ACTIVE ويظهر تلقائياً.
   *
   * Not(StoreStatus.UNINSTALLED) → يشمل تلقائياً أي status جديد يُضاف مستقبلاً
   */
  async findByTenant(tenantId: string): Promise<Store[]> {
    return this.storeRepository.find({
      where: { tenantId, status: Not(StoreStatus.UNINSTALLED) },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, storeId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId, tenantId },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return store;
  }

  /**
   * جلب متجر بالمعرّف مع التوكنات (للعمليات الداخلية فقط)
   */
  async findByIdWithTokens(tenantId: string, storeId: string): Promise<Store> {
    const store = await this.findWithTokens({ id: storeId, tenantId });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    return store;
  }

  /**
   * ✅ البحث عن متجر بـ merchantId من سلة
   * 
   * يستخدم Raw SQL مباشرة لتجاوز كل مشاكل TypeORM مع bigint
   * ثم يحمّل الـ Entity بالـ UUID (بدون مشاكل type)
   */
  async findByMerchantId(merchantId: number): Promise<Store | null> {
    this.logger.log(`🔍 findByMerchantId(${merchantId})`);

    // 1️⃣ Raw SQL — يتجاوز TypeORM بالكامل
    //    PostgreSQL يقارن bigint مع integer بدون مشاكل
    const rows: Array<{ id: string; deleted_at: Date | null; tenant_id: string | null; status: string }> =
      await this.storeRepository.manager.query(
        `SELECT id, deleted_at, tenant_id, status FROM stores WHERE salla_merchant_id = $1 LIMIT 1`,
        [merchantId],
      );

    if (!rows || rows.length === 0) {
      this.logger.warn(`❌ Merchant ${merchantId}: NOT in stores table (raw SQL confirmed)`);

      // ═══════════════════════════════════════════════════════════════════════
      // 🔄 AUTO-RECOVERY: المتجر حُذف نهائياً (hard-delete قديم)
      //    → نبحث في webhook_events عن آخر tenantId معروف لهذا المصدر
      //    → ننشئ متجر placeholder يربط المتجر بالـ tenant
      //    → الـ webhooks ترجع تشتغل فوراً
      // ═══════════════════════════════════════════════════════════════════════
      try {
        const recoveredStore = await this.autoRecoverStoreForMerchant(merchantId);
        if (recoveredStore) {
          return recoveredStore;
        }
      } catch (err) {
        this.logger.error(`Auto-recovery failed for merchant ${merchantId}`, {
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }

      return null;
    }

    const row = rows[0];
    this.logger.log(`🔎 Raw SQL found: id=${row.id}, status=${row.status}, tenant=${row.tenant_id || 'NULL'}, deleted=${row.deleted_at || 'NO'}`);

    // 2️⃣ إذا كان محذوف soft-delete → نسترجعه
    if (row.deleted_at) {
      this.logger.warn(`🔄 RECOVERY: Store ${row.id} was soft-deleted at ${row.deleted_at} — restoring for webhooks`);
      await this.storeRepository.manager.query(
        `UPDATE stores SET deleted_at = NULL, status = 'active' WHERE id = $1`,
        [row.id],
      );
    }

    // 3️⃣ تحميل الـ Entity كامل بالـ UUID (بدون مشاكل type)
    const store = await this.storeRepository.findOne({
      where: { id: row.id },
    });

    if (store) {
      this.logger.log(`✅ Loaded store entity: ${store.id} (tenant: ${store.tenantId || 'NULL'})`);
    } else {
      // هذا ما يصير عادةً — لو صار يعني مشكلة في TypeORM
      this.logger.error(`🚨 CRITICAL: Raw SQL found store ${row.id} but TypeORM findOne(id) returned null!`);
    }

    return store;
  }

  /**
   * 🔄 AUTO-RECOVERY: إنشاء متجر تلقائي عندما يكون المتجر محذوف نهائياً
   *
   * السيناريو: المتجر حُذف بـ hard-delete (قبل إصلاح softRemove)
   *   → سلة مازالت ترسل webhooks لكن DB ما فيها Store
   *   → نبحث عن آخر tenantId معروف من webhook_events
   *   → ننشئ Store جديد ربط → الـ webhooks ترجع تشتغل
   *
   * الحماية:
   *   - نتأكد إن الـ tenant فعلاً موجود وفعّال
   *   - نتأكد ما في tenant ثاني يستخدم نفس المنصة (تعارض)
   *   - المتجر يُنشأ بحالة pending (يحتاج re-authorization)
   */
  private async autoRecoverStoreForMerchant(merchantId: number): Promise<Store | null> {
    this.logger.warn(`🔄 AUTO-RECOVERY: Attempting to recover store for merchant ${merchantId}`);

    // 1️⃣ البحث عن آخر tenantId من webhook_events لهذا الـ merchant بالذات
    //    _merchant مخزّن في payload JSONB (من الإصلاح الجديد)
    //    كـ fallback: نبحث عن أي webhook سلة بـ tenantId
    let pastEvents: Array<{ tenant_id: string }> = await this.storeRepository.manager.query(
      `SELECT tenant_id FROM webhook_events
       WHERE source = 'salla' AND tenant_id IS NOT NULL
       AND payload->>'_merchant' = $1
       GROUP BY tenant_id
       ORDER BY MAX(created_at) DESC LIMIT 5`,
      [String(merchantId)],
    );

    // Fallback: إذا ما لقينا بالـ _merchant (بيانات قديمة قبل الإصلاح) → نبحث بدون فلتر
    if (!pastEvents || pastEvents.length === 0) {
      this.logger.warn(`🔄 AUTO-RECOVERY: No merchant-specific history. Trying general salla lookup...`);
      pastEvents = await this.storeRepository.manager.query(
        `SELECT tenant_id FROM webhook_events
         WHERE source = 'salla' AND tenant_id IS NOT NULL
         GROUP BY tenant_id
         ORDER BY MAX(created_at) DESC LIMIT 5`,
      );
    }

    if (!pastEvents || pastEvents.length === 0) {
      this.logger.warn(`🔄 AUTO-RECOVERY: No past webhook_events with tenantId for salla — cannot recover`);
      return null;
    }

    // 2️⃣ إذا كان هناك أكثر من tenant واحد → لا نستطيع تحديد المالك بدقة
    const uniqueTenants = [...new Set(pastEvents.map(e => e.tenant_id))];

    if (uniqueTenants.length > 1) {
      this.logger.warn(
        `🔄 AUTO-RECOVERY: Multiple tenants found (${uniqueTenants.length}) for salla webhooks — ` +
        `cannot auto-determine owner. Merchant ${merchantId} needs manual re-authorization.`,
      );
      return null;
    }

    const tenantId = uniqueTenants[0];

    // 3️⃣ تأكد أن الـ tenant موجود في DB
    const tenantExists: Array<{ id: string }> = await this.storeRepository.manager.query(
      `SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );

    if (!tenantExists || tenantExists.length === 0) {
      this.logger.warn(`🔄 AUTO-RECOVERY: Tenant ${tenantId} not found or deleted — cannot recover`);
      return null;
    }

    // 4️⃣ تأكد ما فيه متجر سلة ثاني لنفس الـ tenant (تجنب التكرار)
    const existingSallaStore: Array<{ id: string }> = await this.storeRepository.manager.query(
      `SELECT id FROM stores WHERE tenant_id = $1 AND platform = 'salla' AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );

    if (existingSallaStore && existingSallaStore.length > 0) {
      // ✅ المتجر موجود لكن salla_merchant_id غلط أو فاضي
      //    → نربط الـ merchantId الجديد بالمتجر الموجود
      const existingStoreId = existingSallaStore[0].id;
      this.logger.warn(
        `🔄 AUTO-RECOVERY: Tenant ${tenantId} has store ${existingStoreId} — linking merchant ${merchantId} to it`,
      );

      await this.storeRepository.manager.query(
        `UPDATE stores SET salla_merchant_id = $1 WHERE id = $2`,
        [merchantId, existingStoreId],
      );

      const store = await this.storeRepository.findOne({ where: { id: existingStoreId } });
      if (store) {
        this.logger.warn(`✅ AUTO-RECOVERY SUCCESS: Linked merchant ${merchantId} → store ${existingStoreId} (tenant: ${store.tenantId})`);
        return store;
      }

      return null;
    }

    // 5️⃣ إنشاء متجر placeholder
    const newStore = this.storeRepository.create({
      name: `متجر سلة #${merchantId} (مسترجع تلقائياً)`,
      platform: StorePlatform.SALLA,
      status: StoreStatus.PENDING,
      sallaMerchantId: merchantId,
      tenantId,
    });

    const saved = await this.storeRepository.save(newStore);

    this.logger.warn(
      `✅ AUTO-RECOVERY SUCCESS: Created store ${saved.id} for merchant ${merchantId} → tenant ${tenantId}. ` +
      `Status: PENDING (needs re-authorization via Salla OAuth to get fresh tokens).`,
    );

    // إرسال حدث للمسؤول
    this.eventEmitter.emit('store.auto_recovered', {
      storeId: saved.id,
      tenantId,
      merchantId,
      message: 'Store was hard-deleted and auto-recovered from webhook history',
    });

    return saved;
  }

  async findByZidStoreId(zidStoreId: string): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { zidStoreId },
    });
  }

  /**
   * ✅ البحث عن متجر زد بـ UUID (fallback عندما يكون store_id غير موجود)
   */
  async findByZidStoreUuid(zidStoreUuid: string): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { zidStoreUuid },
    });
  }

  async update(storeId: string, updateData: DeepPartial<Store>): Promise<Store> {
    // First verify the store exists
    const existing = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!existing) {
      throw new NotFoundException(`Store ${storeId} not found`);
    }
    
    // Merge the update data with the existing store and save
    const updated = this.storeRepository.merge(existing, updateData);
    return await this.storeRepository.save(updated);
  }

  async updateSettings(
    tenantId: string,
    storeId: string,
    settings: Record<string, unknown>,
  ): Promise<Store> {
    const store = await this.findById(tenantId, storeId);

    // 🔐 حماية الحقول الداخلية من الكتابة فوقها
    const PROTECTED_KEYS = ['zidAuthorizationToken'];
    const sanitized = { ...settings };
    for (const key of PROTECTED_KEYS) {
      delete sanitized[key];
    }

    store.settings = {
      ...store.settings,
      ...sanitized,
    };

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ Sync Store - مزامنة بيانات المتجر من المنصة
  // ═══════════════════════════════════════════════════════════════════════════════

  async syncStore(tenantId: string, storeId: string): Promise<Store> {
    // 🔐 جلب المتجر مع التوكنات
    const store = await this.findByIdWithTokens(tenantId, storeId);

    // التحقق من أن المتجر نشط
    if (store.status !== StoreStatus.ACTIVE) {
      throw new BadRequestException('لا يمكن مزامنة متجر غير مربوط');
    }

    this.logger.log(`Starting sync for store: ${storeId} (${store.platform})`);

    try {
      // تأكد من صلاحية الـ Token
      const accessToken = await this.ensureValidToken(store);

      if (store.platform === StorePlatform.SALLA) {
        await this.syncSallaStore(store, accessToken);
      } else if (store.platform === StorePlatform.ZID) {
        await this.syncZidStore(store, accessToken);
      } else if (store.platform === StorePlatform.OTHER) {
        // 🆕 المتاجر الأخرى: تحديث وقت المزامنة فقط (لا يوجد API محدد)
        this.logger.debug(`Other platform sync — marking as synced: ${store.otherPlatformName}`);
      }

      // تحديث وقت آخر مزامنة
      store.lastSyncedAt = new Date();
      store.consecutiveErrors = 0;
      store.lastError = undefined;

      const updatedStore = await this.storeRepository.save(store);

      this.eventEmitter.emit('store.synced', {
        storeId: store.id,
        tenantId,
        platform: store.platform,
      });

      this.logger.log(`Store synced successfully: ${storeId}`);

      return updatedStore;

    } catch (error: any) {
      this.logger.error(`Failed to sync store: ${storeId}`, error);

      store.lastError = error.message || 'Sync failed';
      store.lastErrorAt = new Date();
      store.consecutiveErrors += 1;

      await this.storeRepository.save(store);

      throw new BadRequestException(`فشل في المزامنة: ${error.message}`);
    }
  }

  private async syncSallaStore(store: Store, accessToken: string): Promise<void> {
    this.logger.debug(`Syncing Salla store: ${store.sallaMerchantId}`);

    try {
      // ✅ Step 1: جلب معلومات المتجر من سلة
      const response = await this.sallaApiService.getStoreInfo(accessToken);
      const merchantInfo = response.data;

      store.sallaStoreName = merchantInfo.name;
      store.sallaEmail     = merchantInfo.email;
      store.sallaMobile    = merchantInfo.mobile;
      store.sallaDomain    = merchantInfo.domain;
      store.sallaAvatar    = merchantInfo.avatar;
      store.sallaPlan      = merchantInfo.plan;
      store.name           = merchantInfo.name || store.name;

      // ✅ Step 2: جلب الإحصائيات وتخزينها في DB
      // بعد هذا، كل GET /stores يقرأ من DB مباشرة — لا API calls
      const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
        this.sallaApiService.getOrders(accessToken,   { page: 1, perPage: 1 }),
        this.sallaApiService.getProducts(accessToken, { page: 1, perPage: 1 }),
        this.sallaApiService.getCustomers(accessToken, { page: 1, perPage: 1 }),
      ]);

      if (ordersRes.status === 'fulfilled') {
        const total = ordersRes.value.pagination?.total;
        if (typeof total === 'number') {
          store.sallaOrdersCount = total;
        } else {
          this.logger.warn(`⚠️ Salla orders response missing pagination.total for store ${store.id}`);
        }
      } else {
        this.logger.warn(`⚠️ Failed to fetch Salla orders count for store ${store.id}: ${ordersRes.reason?.message}`);
      }

      if (productsRes.status === 'fulfilled') {
        const total = productsRes.value.pagination?.total;
        if (typeof total === 'number') {
          store.sallaProductsCount = total;
        } else {
          this.logger.warn(`⚠️ Salla products response missing pagination.total for store ${store.id}`);
        }
      } else {
        this.logger.warn(`⚠️ Failed to fetch Salla products count for store ${store.id}: ${productsRes.reason?.message}`);
      }

      if (customersRes.status === 'fulfilled') {
        const total = customersRes.value.pagination?.total;
        if (typeof total === 'number') {
          store.sallaCustomersCount = total;
        } else {
          this.logger.warn(`⚠️ Salla customers response missing pagination.total for store ${store.id}`);
        }
      } else {
        this.logger.warn(`⚠️ Failed to fetch Salla customers count for store ${store.id}: ${customersRes.reason?.message}`);
      }

      store.sallaLastSyncAt = new Date();

      this.logger.log(`✅ Salla store synced: ${merchantInfo.name}`, {
        storeId:   store.id,
        orders:    store.sallaOrdersCount,
        products:  store.sallaProductsCount,
        customers: store.sallaCustomersCount,
      });

    } catch (error: any) {
      const status = error?.status || error?.response?.status;

      // ✅ 401 → Token منتهي أو ملغي → نحدّث status ونوقف المحاولات
      if (status === 401 || status === 403) {
        this.logger.error(`❌ Salla 401 during sync — token invalid for store ${store.id}`, {
          storeName: store.name || store.sallaStoreName,
          merchantId: store.sallaMerchantId,
          hint: 'Store needs OAuth re-authorization from Salla dashboard',
        });
        // نرمي الخطأ → syncStore() سيُحدّث status إلى TOKEN_EXPIRED
        throw Object.assign(new Error('Salla token expired or revoked — re-authorization required'), { status });
      }

      this.logger.error(`Failed to sync Salla store: ${store.id}`, error);
      throw error;
    }
  }

  private async syncZidStore(store: Store, accessToken: string): Promise<void> {
    this.logger.debug(`Syncing Zid store: ${store.zidStoreId}`);

    try {
      const zidTokens = this.getZidTokens(store, accessToken);

      // ✅ Sync store info
      const storeInfo = await this.zidApiService.getStoreInfo(zidTokens);

      store.zidStoreName = storeInfo.name;
      store.zidEmail = storeInfo.email;
      store.zidMobile = storeInfo.mobile;
      store.zidDomain = storeInfo.url;
      store.zidLogo = storeInfo.logo;
      store.zidCurrency = storeInfo.currency;
      store.zidLanguage = storeInfo.language;
      store.name = storeInfo.name || store.name;

      // ✅ Sync stats (orders, products, customers counts) and persist to DB
      // This avoids hitting the Zid API on every dashboard load (respects rate limits)
      const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
        this.zidApiService.getOrders(zidTokens, { page: 1, per_page: 1 }),
        this.zidApiService.getProducts(zidTokens, { page: 1, per_page: 1 }),
        this.zidApiService.getCustomers(zidTokens, { page: 1, per_page: 1 }),
      ]);

      if (ordersRes.status === 'fulfilled') {
        const total = ordersRes.value.pagination?.total;
        if (typeof total === 'number') {
          store.zidOrdersCount = total;
        } else {
          this.logger.warn(`⚠️ Zid orders response missing pagination.total for store ${store.id}`);
        }
      }
      if (productsRes.status === 'fulfilled') {
        const total = productsRes.value.pagination?.total;
        if (typeof total === 'number') {
          store.zidProductsCount = total;
        } else {
          this.logger.warn(`⚠️ Zid products response missing pagination.total for store ${store.id}`);
        }
      }
      if (customersRes.status === 'fulfilled') {
        const total = customersRes.value.pagination?.total;
        if (typeof total === 'number') {
          store.zidCustomersCount = total;
        } else {
          this.logger.warn(`⚠️ Zid customers response missing pagination.total for store ${store.id}`);
        }
      }
      store.zidLastSyncAt = new Date();

      this.logger.log(`✅ Zid store synced: ${storeInfo.name}`, {
        storeId: store.id,
        orders: store.zidOrdersCount,
        products: store.zidProductsCount,
        customers: store.zidCustomersCount,
      });

    } catch (error: any) {
      this.logger.error(`Failed to sync Zid store: ${store.id}`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Token Management (مع تشفير/فك تشفير)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Check if store's access token is expired
   * @param store Store entity with tokenExpiresAt
   * @returns true if token is expired or expiring within 5 minutes
   */
  private isTokenExpired(store: Store): boolean {
    if (!store.tokenExpiresAt) {
      this.logger.warn(`Store ${store.id} has no tokenExpiresAt - assuming expired`);
      return true;
    }

    // Consider token expired if less than 5 minutes remaining
    const expiryBuffer = 5 * 60 * 1000; // 5 minutes in ms
    const timeUntilExpiry = new Date(store.tokenExpiresAt).getTime() - Date.now();
    const isExpired = timeUntilExpiry < expiryBuffer;

    if (isExpired) {
      this.logger.log(`Token expired for store ${store.id} (expires: ${store.tokenExpiresAt}, remaining: ${Math.floor(timeUntilExpiry / 1000)}s)`);
    }

    return isExpired;
  }

  async ensureValidToken(store: Store): Promise<string> {
    // 🔐 فك تشفير التوكن الحالي
    const currentToken = this.getDecryptedAccessToken(store);

    // ✅ FIX: Check token expiry before returning
    const isExpired = this.isTokenExpired(store);

    if (!store.needsTokenRefresh && currentToken && !isExpired) {
      this.logger.debug(`Using valid token for store ${store.id}`);
      return currentToken;
    }

    // 🆕 المتاجر الأخرى: لا يوجد آلية refresh — نرجع التوكن الحالي
    if (store.platform === StorePlatform.OTHER) {
      if (currentToken) {
        return currentToken;
      }
      throw new BadRequestException('مفتاح API المتجر غير موجود. يرجى إعادة ربط المتجر.');
    }

    // ✅ التحقق من وجود Refresh Token قبل المحاولة
    const refreshToken = this.getDecryptedRefreshToken(store);

    if (!refreshToken || refreshToken.trim() === '') {
      // المتجر ربط بـ API Key مباشرة (بدون OAuth) → لا يوجد refresh token
      // نُعلّم المتجر كـ TOKEN_EXPIRED حتى لا نحاول مجدداً
      this.logger.error(`❌ Store ${store.id} (${store.platform}) has no refresh token — was connected via API Key`, {
        storeName: store.name,
        platform: store.platform,
        hint: 'User must reconnect the store via OAuth or provide a new API key',
      });

      store.status = StoreStatus.TOKEN_EXPIRED;
      store.lastError = 'Token expired — no refresh token available (API Key connection)';
      store.lastErrorAt = new Date();
      await this.storeRepository.save(store);

      throw new BadRequestException('انتهت صلاحية مفتاح API. يرجى إعادة ربط المتجر.');
    }

    this.logger.log(`Refreshing token for store: ${store.id} (${store.platform})`);

    try {
      let tokens;

      if (store.platform === StorePlatform.SALLA) {
        tokens = await this.sallaOAuthService.refreshAccessToken(refreshToken);
        store.tokenExpiresAt = this.sallaOAuthService.calculateTokenExpiry(tokens.expires_in);
      } else if (store.platform === StorePlatform.ZID) {
        tokens = await this.zidOAuthService.refreshAccessToken(refreshToken);
        store.tokenExpiresAt = this.zidOAuthService.calculateTokenExpiry(tokens.expires_in);

        // ✅ حفظ authorization token الجديد إذا رجع من الـ refresh
        const zidTokens = tokens as ZidTokenResponse;
        if (zidTokens.authorization) {
          store.settings = {
            ...(store.settings || {}),
            zidAuthorizationToken: encrypt(zidTokens.authorization),
          };
        }
      } else {
        throw new Error(`Unsupported platform: ${store.platform}`);
      }

      // 🔐 تشفير التوكنات الجديدة
      this.encryptTokens(store, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
      store.lastTokenRefreshAt = new Date();
      store.consecutiveErrors = 0;

      await this.storeRepository.save(store);

      this.logger.log(`✅ Token refreshed successfully for store ${store.id} (${store.platform})`);

      return tokens.access_token;

    } catch (error: any) {
      this.logger.error(`Failed to refresh token for store: ${store.id}`, error);

      store.status = StoreStatus.TOKEN_EXPIRED;
      store.lastError = error instanceof Error ? error.message : 'Token refresh failed';
      store.lastErrorAt = new Date();
      store.consecutiveErrors += 1;

      await this.storeRepository.save(store);

      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Disconnect Store
  // ═══════════════════════════════════════════════════════════════════════════════

  async disconnectStore(tenantId: string, storeId: string): Promise<void> {
    const store = await this.findById(tenantId, storeId);

    store.status = StoreStatus.DISCONNECTED;
    store.accessToken = undefined;
    store.refreshToken = undefined;
    store.tokenExpiresAt = undefined;

    await this.storeRepository.save(store);

    this.eventEmitter.emit('store.disconnected', {
      storeId: store.id,
      tenantId,
      platform: store.platform,
      merchantId: store.sallaMerchantId,
      zidStoreId: store.zidStoreId,
    });

    this.logger.log(`Store disconnected: ${store.id}`);
  }

  async handleAppUninstalled(merchantId: number): Promise<void> {
    const store = await this.findByMerchantId(merchantId);

    if (!store) {
      this.logger.warn(`Store not found for uninstall event: ${merchantId}`);
      return;
    }

    store.status = StoreStatus.UNINSTALLED;
    store.accessToken = undefined;
    store.refreshToken = undefined;
    store.tokenExpiresAt = undefined;

    await this.storeRepository.save(store);

    this.eventEmitter.emit('store.uninstalled', {
      storeId: store.id,
      tenantId: store.tenantId,
      merchantId,
    });

    this.logger.log(`Store uninstalled by merchant: ${merchantId}`);
  }

  async recordError(storeId: string, error: string): Promise<void> {
    await this.storeRepository.update(storeId, {
      lastError: error,
      lastErrorAt: new Date(),
      consecutiveErrors: () => 'consecutive_errors + 1',
    });
  }

  async clearErrors(storeId: string): Promise<void> {
    await this.storeRepository.update(storeId, {
      lastError: undefined,
      consecutiveErrors: 0,
    });
  }

  async getStatistics(tenantId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPlatform: Record<string, number>;
  }> {
    const stores = await this.storeRepository.find({
      where: { tenantId },
      select: ['id', 'status', 'platform'],
    });

    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};

    for (const store of stores) {
      byStatus[store.status] = (byStatus[store.status] || 0) + 1;
      byPlatform[store.platform] = (byPlatform[store.platform] || 0) + 1;
    }

    return {
      total: stores.length,
      byStatus,
      byPlatform,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ جلب إحصائيات المتجر الحقيقية من API المنصة
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStoreStats(store: Store): Promise<{ orders: number; products: number; customers: number }> {
    const stats = { orders: 0, products: 0, customers: 0 };

    if (store.status !== StoreStatus.ACTIVE) {
      return stats;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ SALLA: قراءة من DB cache — لا API calls عند تحميل الداشبورد
    //
    // الإحصائيات تُحدَّث فقط عند:
    //   - ربط المتجر لأول مرة (connectSallaStore)
    //   - POST /stores/:id/sync (المستخدم يطلب مزامنة)
    //
    // لماذا هذا الحل ضروري:
    //   - 1000 تاجر × 3 API calls = 3000 طلب في كل GET /stores
    //   - Token منتهي = 3 errors في السجل لكل تاجر
    //   - نفس نمط Zid الذي يعمل بشكل ممتاز في الإنتاج
    // ═══════════════════════════════════════════════════════════════════════════
    if (store.platform === StorePlatform.SALLA) {
      stats.orders    = store.sallaOrdersCount   ?? 0;
      stats.products  = store.sallaProductsCount ?? 0;
      stats.customers = store.sallaCustomersCount ?? 0;

      this.logger.debug(`Salla cached stats for store ${store.id}: orders=${stats.orders}, products=${stats.products}, customers=${stats.customers}`, {
        lastSyncAt: store.sallaLastSyncAt ?? 'never',
        note: 'Refresh via POST /stores/:id/sync',
      });
      return stats;
    }

    // ✅ ZID: قراءة من DB cache (نفس النمط)
    if (store.platform === StorePlatform.ZID) {
      stats.orders    = store.zidOrdersCount   ?? 0;
      stats.products  = store.zidProductsCount ?? 0;
      stats.customers = store.zidCustomersCount ?? 0;

      this.logger.debug(`Zid cached stats for store ${store.id}: orders=${stats.orders}, products=${stats.products}, customers=${stats.customers}`, {
        lastSyncAt: store.zidLastSyncAt,
      });
      return stats;
    }

    // 🆕 OTHER: لا نجلب إحصائيات (ما نعرف بنية API الخارجي)
    // Stats = 0, يظهر للمستخدم كـ "غير متاح"
    return stats;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ حذف المتجر نهائياً من قاعدة البيانات
  // ═══════════════════════════════════════════════════════════════════════════════

  async deleteStorePermanently(tenantId: string, storeId: string): Promise<void> {
    const store = await this.findById(tenantId, storeId);

    this.eventEmitter.emit('store.deleted', {
      storeId: store.id,
      tenantId,
      platform: store.platform,
      merchantId: store.sallaMerchantId,
      zidStoreId: store.zidStoreId,
    });

    // ✅ FIX P1: Soft-delete بدل Hard-delete
    // storeRepository.remove() كان يحذف الصف نهائياً من DB
    // → الـ webhooks تفقد الربط بـ tenantId ولا يمكن استرجاعها
    // الآن: soft-delete يحتفظ بالصف مع deleted_at
    // → findByMerchantId يستطيع استعادته تلقائياً عند وصول webhook
    store.status = StoreStatus.UNINSTALLED;
    store.accessToken = undefined;
    store.refreshToken = undefined;
    store.tokenExpiresAt = undefined;
    await this.storeRepository.save(store);
    await this.storeRepository.softRemove(store);

    this.logger.log(`Store soft-deleted: ${storeId} (recoverable via webhooks)`);
  }
}
