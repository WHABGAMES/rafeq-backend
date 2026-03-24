/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM — Salla Store Service                              ║
 * ║                                                                                ║
 * ║  مسؤولية هذا الملف: كل ما يخص منصة سلة فقط                                  ║
 * ║  ─────────────────────────────────────────────────────────────                ║
 * ║  ✅ ربط متجر سلة                 connectSallaStore()                          ║
 * ║  ✅ البحث بـ merchantId           findByMerchantId()                          ║
 * ║  ✅ مزامنة بيانات سلة             syncSallaStore()                            ║
 * ║  ✅ إلغاء تثبيت سلة               handleAppUninstalled()                      ║
 * ║  ✅ استرجاع تلقائي للمتاجر        autoRecoverStoreForMerchant()               ║
 * ║                                                                                ║
 * ║  ⚠️  هذا الملف لا يحتوي على أي كود خاص بـ Zid                               ║
 * ║     التعديل هنا لا يؤثر على نظام Zid بأي شكل                                ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/salla-store.service.ts                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { encrypt } from '@common/utils/encryption.util';
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';
import { SallaMerchantInfo } from './salla-oauth.service';
import { SallaApiService } from './salla-api.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectSallaStoreData {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  merchantInfo: SallaMerchantInfo;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SallaStoreService {
  private readonly logger = new Logger(SallaStoreService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    private readonly sallaApiService: SallaApiService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔗 ربط المتجر
  // ═══════════════════════════════════════════════════════════════════════════

  async connectSallaStore(
    tenantId: string,
    data: ConnectSallaStoreData,
  ): Promise<Store> {
    const { tokens, merchantInfo } = data;

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
      // بيانات المتجر
      sallaStoreName: merchantInfo.name,
      sallaEmail: merchantInfo.email,
      sallaMobile: merchantInfo.mobile,
      sallaDomain: merchantInfo.domain,
      sallaAvatar: merchantInfo.avatar,
      sallaPlan: merchantInfo.plan,
      // ✅ بيانات المالك الشخصية
      sallaOwnerEmail: merchantInfo.ownerEmail,
      sallaOwnerMobile: merchantInfo.ownerMobile,
      sallaOwnerName: merchantInfo.ownerName,
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

    store.accessToken  = encrypt(tokens.accessToken)  ?? undefined;
    store.refreshToken = encrypt(tokens.refreshToken) ?? undefined;

    const savedStore = await this.storeRepository.save(store);

    this.eventEmitter.emit('store.connected', {
      storeId: savedStore.id,
      tenantId,
      platform: StorePlatform.SALLA,
      merchantId: merchantInfo.id,
    });

    this.logger.log(`✅ Salla store connected: ${savedStore.name}`, {
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
    store.accessToken     = encrypt(tokens.accessToken)  ?? undefined;
    store.refreshToken    = encrypt(tokens.refreshToken) ?? undefined;
    store.tokenExpiresAt  = tokens.expiresAt;
    store.status          = StoreStatus.ACTIVE;
    store.lastSyncedAt    = new Date();
    store.consecutiveErrors = 0;
    store.lastError       = undefined;
    store.sallaStoreName  = merchantInfo.name;
    store.sallaEmail      = merchantInfo.email;
    store.sallaMobile     = merchantInfo.mobile;
    store.sallaDomain     = merchantInfo.domain;
    store.sallaAvatar     = merchantInfo.avatar;
    store.sallaPlan       = merchantInfo.plan;

    // ✅ بيانات المالك الشخصية
    if (merchantInfo.ownerEmail) store.sallaOwnerEmail = merchantInfo.ownerEmail;
    if (merchantInfo.ownerMobile) store.sallaOwnerMobile = merchantInfo.ownerMobile;
    if (merchantInfo.ownerName) store.sallaOwnerName = merchantInfo.ownerName;

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔍 البحث
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * البحث عن متجر سلة بـ merchantId
   * يستخدم Raw SQL لتجاوز مشاكل TypeORM مع bigint
   */
  async findByMerchantId(merchantId: number): Promise<Store | null> {
    this.logger.log(`🔍 findByMerchantId(${merchantId})`);

    const rows: Array<{ id: string; deleted_at: Date | null; tenant_id: string | null; status: string }> =
      await this.storeRepository.manager.query(
        `SELECT id, deleted_at, tenant_id, status FROM stores WHERE salla_merchant_id = $1 LIMIT 1`,
        [merchantId],
      );

    if (!rows || rows.length === 0) {
      this.logger.warn(`❌ Merchant ${merchantId}: NOT in stores table`);

      try {
        const recoveredStore = await this.autoRecoverStoreForMerchant(merchantId);
        if (recoveredStore) return recoveredStore;
      } catch (err) {
        this.logger.error(`Auto-recovery failed for merchant ${merchantId}`, {
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }

      return null;
    }

    const row = rows[0];
    this.logger.log(`🔎 Raw SQL found: id=${row.id}, status=${row.status}, tenant=${row.tenant_id || 'NULL'}, deleted=${row.deleted_at || 'NO'}`);

    if (row.deleted_at) {
      this.logger.warn(`🔄 RECOVERY: Store ${row.id} was soft-deleted — restoring for webhooks`);
      await this.storeRepository.manager.query(
        `UPDATE stores SET deleted_at = NULL, status = 'active' WHERE id = $1`,
        [row.id],
      );
    }

    const store = await this.storeRepository.findOne({ where: { id: row.id } });

    if (!store) {
      this.logger.error(`🚨 CRITICAL: Raw SQL found store ${row.id} but TypeORM findOne returned null!`);
    }

    return store ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔄 مزامنة المتجر
  // ═══════════════════════════════════════════════════════════════════════════

  async syncSallaStore(store: Store, accessToken: string): Promise<void> {
    this.logger.debug(`Syncing Salla store: ${store.sallaMerchantId}`);

    try {
      // Step 1: جلب معلومات المتجر
      const response = await this.sallaApiService.getStoreInfo(accessToken);
      const merchantInfo = response.data;

      store.sallaStoreName = merchantInfo.name;
      store.sallaEmail     = merchantInfo.email;
      store.sallaMobile    = merchantInfo.mobile;
      store.sallaDomain    = merchantInfo.domain;
      store.sallaAvatar    = merchantInfo.avatar;
      store.sallaPlan      = merchantInfo.plan;
      store.name           = merchantInfo.name || store.name;

      // Step 2: جلب الإحصائيات وتخزينها في DB
      // GET /stores يقرأ من DB — لا API calls عند تحميل الداشبورد
      const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
        this.sallaApiService.getOrders(accessToken,    { page: 1, perPage: 1 }),
        this.sallaApiService.getProducts(accessToken,  { page: 1, perPage: 1 }),
        this.sallaApiService.getCustomers(accessToken, { page: 1, perPage: 1 }),
      ]);

      if (ordersRes.status === 'fulfilled') {
        const total = ordersRes.value.pagination?.total;
        if (typeof total === 'number') store.sallaOrdersCount = total;
        else this.logger.warn(`⚠️ Salla orders missing pagination.total for store ${store.id}`);
      } else {
        this.logger.warn(`⚠️ Failed to fetch Salla orders count: ${ordersRes.reason?.message}`);
      }

      if (productsRes.status === 'fulfilled') {
        const total = productsRes.value.pagination?.total;
        if (typeof total === 'number') store.sallaProductsCount = total;
        else this.logger.warn(`⚠️ Salla products missing pagination.total for store ${store.id}`);
      } else {
        this.logger.warn(`⚠️ Failed to fetch Salla products count: ${productsRes.reason?.message}`);
      }

      if (customersRes.status === 'fulfilled') {
        const total = customersRes.value.pagination?.total;
        if (typeof total === 'number') store.sallaCustomersCount = total;
        else this.logger.warn(`⚠️ Salla customers missing pagination.total for store ${store.id}`);
      } else {
        this.logger.warn(`⚠️ Failed to fetch Salla customers count: ${customersRes.reason?.message}`);
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

      if (status === 401 || status === 403) {
        this.logger.error(`❌ Salla 401 — token invalid for store ${store.id}`, {
          storeName:  store.name || store.sallaStoreName,
          merchantId: store.sallaMerchantId,
          hint: 'Store needs OAuth re-authorization from Salla dashboard',
        });
        throw Object.assign(
          new Error('Salla token expired or revoked — re-authorization required'),
          { status },
        );
      }

      this.logger.error(`Failed to sync Salla store ${store.id}`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ❌ إلغاء التثبيت
  // ═══════════════════════════════════════════════════════════════════════════

  async handleAppUninstalled(merchantId: number): Promise<void> {
    const store = await this.findByMerchantId(merchantId);

    if (!store) {
      this.logger.warn(`Store not found for Salla uninstall event: ${merchantId}`);
      return;
    }

    store.status       = StoreStatus.UNINSTALLED;
    store.accessToken  = undefined;
    store.refreshToken = undefined;
    store.tokenExpiresAt = undefined;

    await this.storeRepository.save(store);

    this.eventEmitter.emit('store.uninstalled', {
      storeId:    store.id,
      tenantId:   store.tenantId,
      merchantId,
    });

    this.logger.log(`✅ Salla store uninstalled: merchant ${merchantId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔄 استرجاع تلقائي للمتاجر المحذوفة
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * عندما يكون المتجر محذوف hard-delete (قديم) وسلة ترسل webhooks:
   * نبحث عن آخر tenantId من webhook_events ونُعيد ربط المتجر
   */
  private async autoRecoverStoreForMerchant(merchantId: number): Promise<Store | null> {
    this.logger.warn(`🔄 AUTO-RECOVERY: Attempting to recover Salla store for merchant ${merchantId}`);

    let pastEvents: Array<{ tenant_id: string }> = await this.storeRepository.manager.query(
      `SELECT tenant_id FROM webhook_events
       WHERE source = 'salla' AND tenant_id IS NOT NULL
       AND payload->>'_merchant' = $1
       GROUP BY tenant_id
       ORDER BY MAX(created_at) DESC LIMIT 5`,
      [String(merchantId)],
    );

    if (!pastEvents || pastEvents.length === 0) {
      // ✅ FIX CRITICAL: لا نبحث بشكل عام!
      // البحث العام كان يربط متاجر جديدة على tenants قديمة بالغلط
      // المتجر الجديد سيُنشأ بشكل صحيح عبر app.store.authorize
      this.logger.warn(`🔄 AUTO-RECOVERY: No merchant-specific history — skipping (new merchant will be handled by app.store.authorize)`);
      return null;
    }

    const uniqueTenants = [...new Set(pastEvents.map(e => e.tenant_id))];

    if (uniqueTenants.length > 1) {
      this.logger.warn(
        `🔄 AUTO-RECOVERY: Multiple tenants (${uniqueTenants.length}) — cannot auto-determine owner for merchant ${merchantId}`,
      );
      return null;
    }

    const tenantId = uniqueTenants[0];

    const tenantExists: Array<{ id: string }> = await this.storeRepository.manager.query(
      `SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );

    if (!tenantExists || tenantExists.length === 0) {
      this.logger.warn(`🔄 AUTO-RECOVERY: Tenant ${tenantId} not found or deleted`);
      return null;
    }

    const existingSallaStore: Array<{ id: string }> = await this.storeRepository.manager.query(
      `SELECT id FROM stores WHERE tenant_id = $1 AND platform = 'salla' AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );

    if (existingSallaStore && existingSallaStore.length > 0) {
      // ✅ FIX CRITICAL: لا نستبدل merchantId لمتجر موجود!
      // هذا كان يسرق متجر تاجر ويعطيه لتاجر ثاني
      const existingStoreId = existingSallaStore[0].id;

      // نتحقق: هل هذا المتجر نفسه (نفس merchantId) أو متجر مختلف؟
      const storeCheck: Array<{ salla_merchant_id: number }> = await this.storeRepository.manager.query(
        `SELECT salla_merchant_id FROM stores WHERE id = $1`,
        [existingStoreId],
      );

      if (storeCheck?.[0]?.salla_merchant_id && storeCheck[0].salla_merchant_id !== merchantId) {
        // متجر مختلف تماماً! لا نربطه
        this.logger.warn(
          `🔄 AUTO-RECOVERY: BLOCKED — store ${existingStoreId} belongs to merchant ${storeCheck[0].salla_merchant_id}, not ${merchantId}. Skipping.`,
        );
        return null;
      }

      // نفس المتجر (merchantId متطابق أو فارغ) — آمن للاسترجاع
      this.logger.warn(
        `🔄 AUTO-RECOVERY: Restoring merchant ${merchantId} → existing store ${existingStoreId}`,
      );

      await this.storeRepository.manager.query(
        `UPDATE stores SET salla_merchant_id = $1 WHERE id = $2 AND (salla_merchant_id IS NULL OR salla_merchant_id = $1)`,
        [merchantId, existingStoreId],
      );

      const store = await this.storeRepository.findOne({ where: { id: existingStoreId } });
      if (store) {
        this.logger.warn(`✅ AUTO-RECOVERY SUCCESS: merchant ${merchantId} → store ${existingStoreId}`);
        return store;
      }
      return null;
    }

    const newStore = this.storeRepository.create({
      name: `متجر سلة #${merchantId} (مسترجع تلقائياً)`,
      platform: StorePlatform.SALLA,
      status: StoreStatus.PENDING,
      sallaMerchantId: merchantId,
      tenantId,
    });

    const saved = await this.storeRepository.save(newStore);

    this.logger.warn(
      `✅ AUTO-RECOVERY SUCCESS: Created placeholder store ${saved.id} for merchant ${merchantId} → tenant ${tenantId}`,
    );

    this.eventEmitter.emit('store.auto_recovered', {
      storeId:    saved.id,
      tenantId,
      merchantId,
      message: 'Salla store was hard-deleted and auto-recovered from webhook history',
    });

    return saved;
  }
}
