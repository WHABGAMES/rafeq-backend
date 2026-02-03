/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Service                             ║
 * ║                                                                                ║
 * ║  ✅ Fixed: إضافة syncStore method                                              ║
 * ║  ✅ يدعم سلة وزد                                                               ║
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
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

// Services
import { SallaOAuthService, SallaMerchantInfo } from './salla-oauth.service';
import { SallaApiService } from './salla-api.service';
import { ZidOAuthService, ZidStoreInfo } from './zid-oauth.service';
import { ZidApiService } from './zid-api.service';

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
  };
  storeInfo: ZidStoreInfo;
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
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 Salla Store Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectSallaStore(
    tenantId: string,
    data: ConnectSallaStoreData,
  ): Promise<Store> {
    const { tokens, merchantInfo } = data;

    const existingStore = await this.storeRepository.findOne({
      where: { sallaMerchantId: merchantInfo.id },
    });

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
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      sallaStoreName: merchantInfo.name,
      sallaEmail: merchantInfo.email,
      sallaMobile: merchantInfo.mobile,
      sallaDomain: merchantInfo.domain,
      sallaAvatar: merchantInfo.avatar,
      sallaPlan: merchantInfo.plan,
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
    store.accessToken = tokens.accessToken;
    store.refreshToken = tokens.refreshToken;
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
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
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
      },
      subscribedEvents: [
        'order.created',
        'customer.created',
        'order.status.updated',
      ],
      lastSyncedAt: new Date(),
    });

    const savedStore = await this.storeRepository.save(store);

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
    store.accessToken = tokens.accessToken;
    store.refreshToken = tokens.refreshToken;
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

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Common Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  async findByTenant(tenantId: string): Promise<Store[]> {
    return this.storeRepository.find({
      where: { tenantId },
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

  async findByMerchantId(merchantId: number): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { sallaMerchantId: merchantId },
    });
  }

  async findByZidStoreId(zidStoreId: string): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { zidStoreId },
    });
  }

  async updateSettings(
    tenantId: string,
    storeId: string,
    settings: Record<string, unknown>,
  ): Promise<Store> {
    const store = await this.findById(tenantId, storeId);

    store.settings = {
      ...store.settings,
      ...settings,
    };

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ NEW: Sync Store - مزامنة بيانات المتجر من المنصة
  // ═══════════════════════════════════════════════════════════════════════════════

  async syncStore(tenantId: string, storeId: string): Promise<Store> {
    const store = await this.findById(tenantId, storeId);

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
      // جلب بيانات المتجر من سلة
      const response = await this.sallaApiService.getStoreInfo(accessToken);
      const merchantInfo = response.data;

      // تحديث بيانات المتجر
      store.sallaStoreName = merchantInfo.name;
      store.sallaEmail = merchantInfo.email;
      store.sallaMobile = merchantInfo.mobile;
      store.sallaDomain = merchantInfo.domain;
      store.sallaAvatar = merchantInfo.avatar;
      store.sallaPlan = merchantInfo.plan;
      store.name = merchantInfo.name || store.name;

      this.logger.debug(`Salla store synced: ${merchantInfo.name}`);

    } catch (error: any) {
      this.logger.error(`Failed to sync Salla store: ${store.id}`, error);
      throw error;
    }
  }

  private async syncZidStore(store: Store, accessToken: string): Promise<void> {
    this.logger.debug(`Syncing Zid store: ${store.zidStoreId}`);

    try {
      // جلب بيانات المتجر من زد - يرجع الـ object مباشرة
      const storeInfo = await this.zidApiService.getStoreInfo(accessToken);

      // تحديث بيانات المتجر
      store.zidStoreName = storeInfo.name;
      store.zidEmail = storeInfo.email;
      store.zidMobile = storeInfo.mobile;
      store.zidDomain = storeInfo.url;
      store.zidLogo = storeInfo.logo;
      store.zidCurrency = storeInfo.currency;
      store.zidLanguage = storeInfo.language;
      store.name = storeInfo.name || store.name;

      this.logger.debug(`Zid store synced: ${storeInfo.name}`);

    } catch (error: any) {
      this.logger.error(`Failed to sync Zid store: ${store.id}`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Token Management
  // ═══════════════════════════════════════════════════════════════════════════════

  async ensureValidToken(store: Store): Promise<string> {
    if (!store.needsTokenRefresh && store.accessToken) {
      return store.accessToken;
    }

    this.logger.log(`Refreshing token for store: ${store.id} (${store.platform})`);

    try {
      let tokens;

      if (store.platform === StorePlatform.SALLA) {
        tokens = await this.sallaOAuthService.refreshAccessToken(store.refreshToken!);
        store.tokenExpiresAt = this.sallaOAuthService.calculateTokenExpiry(tokens.expires_in);
      } else if (store.platform === StorePlatform.ZID) {
        tokens = await this.zidOAuthService.refreshAccessToken(store.refreshToken!);
        store.tokenExpiresAt = this.zidOAuthService.calculateTokenExpiry(tokens.expires_in);
      } else {
        throw new Error(`Unsupported platform: ${store.platform}`);
      }

      store.accessToken = tokens.access_token;
      store.refreshToken = tokens.refresh_token;
      store.lastTokenRefreshAt = new Date();
      store.consecutiveErrors = 0;

      await this.storeRepository.save(store);

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

    if (store.status !== StoreStatus.ACTIVE || !store.accessToken) {
      return stats;
    }

    try {
      const accessToken = await this.ensureValidToken(store);

      if (store.platform === StorePlatform.SALLA) {
        const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
          this.sallaApiService.getOrders(accessToken, { page: 1, perPage: 50 }),
          this.sallaApiService.getProducts(accessToken, { page: 1, perPage: 1 }),
          this.sallaApiService.getCustomers(accessToken, { page: 1, perPage: 1 }),
        ]);

        if (ordersRes.status === 'fulfilled') {
          stats.orders = ordersRes.value.pagination?.total
            ?? (Array.isArray(ordersRes.value.data) ? ordersRes.value.data.length : 0);
        }
        if (productsRes.status === 'fulfilled') {
          stats.products = productsRes.value.pagination?.total
            ?? (Array.isArray(productsRes.value.data) ? productsRes.value.data.length : 0);
        }
        if (customersRes.status === 'fulfilled') {
          stats.customers = customersRes.value.pagination?.total
            ?? (Array.isArray(customersRes.value.data) ? customersRes.value.data.length : 0);
        }

      } else if (store.platform === StorePlatform.ZID) {
        const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
          this.zidApiService.getOrders(accessToken, { page: 1, per_page: 50 }),
          this.zidApiService.getProducts(accessToken, { page: 1, per_page: 1 }),
          this.zidApiService.getCustomers(accessToken, { page: 1, per_page: 1 }),
        ]);

        if (ordersRes.status === 'fulfilled') {
          stats.orders = ordersRes.value.pagination?.total
            ?? (Array.isArray(ordersRes.value.data) ? ordersRes.value.data.length : 0);
        }
        if (productsRes.status === 'fulfilled') {
          stats.products = productsRes.value.pagination?.total
            ?? (Array.isArray(productsRes.value.data) ? productsRes.value.data.length : 0);
        }
        if (customersRes.status === 'fulfilled') {
          stats.customers = customersRes.value.pagination?.total
            ?? (Array.isArray(customersRes.value.data) ? customersRes.value.data.length : 0);
        }
      }

      this.logger.debug(`Store stats for ${store.id}: orders=${stats.orders}, products=${stats.products}, customers=${stats.customers}`);

    } catch (error: any) {
      this.logger.warn(`Failed to fetch stats for store ${store.id}: ${error.message}`);
    }

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

    await this.storeRepository.remove(store);

    this.logger.log(`Store permanently deleted: ${storeId}`);
  }
}
