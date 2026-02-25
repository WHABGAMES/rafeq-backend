/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM — Stores Service (Facade)                    ║
 * ║                                                                                ║
 * ║  هذا الملف هو الواجهة الموحّدة — يُفوّض لـ:                                  ║
 * ║    • SallaStoreService  ← كل ما يخص سلة                                      ║
 * ║    • ZidStoreService    ← كل ما يخص زد                                        ║
 * ║                                                                                ║
 * ║  ما يبقى هنا (مشترك):                                                         ║
 * ║    findById, findByTenant, syncStore, ensureValidToken                         ║
 * ║    disconnectStore, deleteStorePermanently, getStoreStats                      ║
 * ║                                                                                ║
 * ║  ✅ لا يوجد كود Salla أو Zid مباشرة — كل منصة في service منفصل              ║
 * ║  ✅ التعديل على Salla لا يلمس هذا الملف                                       ║
 * ║  ✅ التعديل على Zid لا يلمس هذا الملف                                         ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/stores.service.ts                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial, Not } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { encrypt, decrypt } from '@common/utils/encryption.util';
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

import { SallaStoreService, ConnectSallaStoreData } from './salla-store.service';
import { ZidStoreService, ConnectZidStoreData } from './zid-store.service';
import { SallaOAuthService } from './salla-oauth.service';
import { ZidOAuthService, ZidTokenResponse } from './zid-oauth.service';

// ─── Other Platform ───────────────────────────────────────────────────────────

interface ConnectOtherStoreData {
  tokens: { accessToken: string; refreshToken: string; expiresAt: Date };
  storeInfo: {
    platformName: string;
    apiBaseUrl: string;
    name: string;
    url: string;
    storeId: string;
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    // ✅ Platform services — كل منصة معزولة
    private readonly sallaStoreService: SallaStoreService,
    private readonly zidStoreService: ZidStoreService,

    // OAuth (لتجديد التوكنات فقط)
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly zidOAuthService: ZidOAuthService,

    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔐 Token Helpers (مشترك)
  // ═══════════════════════════════════════════════════════════════════════════

  private encryptTokens(store: Store, tokens: { accessToken: string; refreshToken: string }): void {
    store.accessToken  = encrypt(tokens.accessToken)  ?? undefined;
    store.refreshToken = encrypt(tokens.refreshToken) ?? undefined;
  }

  private async findWithTokens(where: Record<string, any>): Promise<Store | null> {
    return this.storeRepository
      .createQueryBuilder('store')
      .addSelect('store.accessToken')
      .addSelect('store.refreshToken')
      .where(where)
      .getOne();
  }

  private getDecryptedAccessToken(store: Store): string | null {
    return decrypt(store.accessToken ?? null);
  }

  private getDecryptedRefreshToken(store: Store): string | null {
    return decrypt(store.refreshToken ?? null);
  }

  private isTokenExpired(store: Store): boolean {
    if (!store.tokenExpiresAt) return true;
    const expiryBuffer    = 5 * 60 * 1000;
    const timeUntilExpiry = new Date(store.tokenExpiresAt).getTime() - Date.now();
    return timeUntilExpiry < expiryBuffer;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛒 Salla — يُفوّض بالكامل لـ SallaStoreService
  // ═══════════════════════════════════════════════════════════════════════════

  async connectSallaStore(tenantId: string, data: ConnectSallaStoreData): Promise<Store> {
    return this.sallaStoreService.connectSallaStore(tenantId, data);
  }

  async findByMerchantId(merchantId: number): Promise<Store | null> {
    return this.sallaStoreService.findByMerchantId(merchantId);
  }

  async handleAppUninstalled(merchantId: number): Promise<void> {
    return this.sallaStoreService.handleAppUninstalled(merchantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🏪 Zid — يُفوّض بالكامل لـ ZidStoreService
  // ═══════════════════════════════════════════════════════════════════════════

  async connectZidStore(tenantId: string, data: ConnectZidStoreData): Promise<Store> {
    return this.zidStoreService.connectZidStore(tenantId, data);
  }

  async findByZidStoreId(zidStoreId: string): Promise<Store | null> {
    return this.zidStoreService.findByZidStoreId(zidStoreId);
  }

  async findByZidStoreUuid(zidStoreUuid: string): Promise<Store | null> {
    return this.zidStoreService.findByZidStoreUuid(zidStoreUuid);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 Other Platform
  // ═══════════════════════════════════════════════════════════════════════════

  async connectOtherStore(tenantId: string, data: ConnectOtherStoreData): Promise<Store> {
    const { tokens, storeInfo } = data;

    const existingStore = await this.storeRepository.findOne({
      where: { tenantId, platform: StorePlatform.OTHER, otherApiBaseUrl: storeInfo.apiBaseUrl },
    });

    if (existingStore) {
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
      settings: { autoReply: true, welcomeMessageEnabled: true, orderNotificationsEnabled: true },
      subscribedEvents: [],
      lastSyncedAt: new Date(),
    });

    this.encryptTokens(store, tokens);
    const savedStore = await this.storeRepository.save(store);

    this.eventEmitter.emit('store.connected', {
      storeId: savedStore.id, tenantId, platform: StorePlatform.OTHER,
      platformName: storeInfo.platformName,
    });

    this.logger.log(`🆕 Other platform store connected: ${savedStore.name}`);
    return savedStore;
  }

  private async updateOtherStoreConnection(
    store: Store,
    tokens: ConnectOtherStoreData['tokens'],
    storeInfo: ConnectOtherStoreData['storeInfo'],
  ): Promise<Store> {
    this.encryptTokens(store, tokens);
    store.tokenExpiresAt    = tokens.expiresAt;
    store.status            = StoreStatus.ACTIVE;
    store.lastSyncedAt      = new Date();
    store.consecutiveErrors = 0;
    store.lastError         = undefined;
    store.name              = storeInfo.name || store.name;
    store.otherPlatformName = storeInfo.platformName;
    store.otherStoreUrl     = storeInfo.url || store.otherStoreUrl;
    store.otherStoreId      = storeInfo.storeId || store.otherStoreId;
    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 Shared — مشترك بين كل المنصات
  // ═══════════════════════════════════════════════════════════════════════════

  async findByTenant(tenantId: string): Promise<Store[]> {
    return this.storeRepository.find({
      where: { tenantId, status: Not(StoreStatus.UNINSTALLED) },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, storeId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({ where: { id: storeId, tenantId } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async findByIdWithTokens(tenantId: string, storeId: string): Promise<Store> {
    const store = await this.findWithTokens({ id: storeId, tenantId });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async update(storeId: string, updateData: DeepPartial<Store>): Promise<Store> {
    const existing = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!existing) throw new NotFoundException(`Store ${storeId} not found`);
    const updated = this.storeRepository.merge(existing, updateData);
    return this.storeRepository.save(updated);
  }

  async updateSettings(tenantId: string, storeId: string, settings: Record<string, unknown>): Promise<Store> {
    const store = await this.findById(tenantId, storeId);
    const PROTECTED_KEYS = ['zidAuthorizationToken'];
    const sanitized = { ...settings };
    for (const key of PROTECTED_KEYS) delete sanitized[key];
    store.settings = { ...store.settings, ...sanitized };
    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔄 Sync — يُوجّه لكل service حسب المنصة
  // ═══════════════════════════════════════════════════════════════════════════

  async syncStore(tenantId: string, storeId: string): Promise<Store> {
    const store = await this.findByIdWithTokens(tenantId, storeId);

    if (store.status !== StoreStatus.ACTIVE) {
      throw new BadRequestException('لا يمكن مزامنة متجر غير مربوط');
    }

    this.logger.log(`Starting sync for store: ${storeId} (${store.platform})`);

    try {
      const accessToken = await this.ensureValidToken(store);

      // ✅ كل منصة في service منفصل — لا تداخل ولا تأثير متبادل
      if (store.platform === StorePlatform.SALLA) {
        await this.sallaStoreService.syncSallaStore(store, accessToken);
      } else if (store.platform === StorePlatform.ZID) {
        await this.zidStoreService.syncZidStore(store, accessToken);
      } else if (store.platform === StorePlatform.OTHER) {
        this.logger.debug(`Other platform sync — marking as synced: ${store.otherPlatformName}`);
      }

      store.lastSyncedAt      = new Date();
      store.consecutiveErrors = 0;
      store.lastError         = undefined;

      const updatedStore = await this.storeRepository.save(store);

      this.eventEmitter.emit('store.synced', { storeId: store.id, tenantId, platform: store.platform });
      this.logger.log(`✅ Store synced: ${storeId}`);

      return updatedStore;

    } catch (error: any) {
      store.lastError         = error.message || 'Sync failed';
      store.lastErrorAt       = new Date();
      store.consecutiveErrors += 1;
      await this.storeRepository.save(store);
      throw new BadRequestException(`فشل في المزامنة: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔐 Token Refresh (مشترك — يعرف المنصة من store.platform)
  // ═══════════════════════════════════════════════════════════════════════════

  async ensureValidToken(store: Store): Promise<string> {
    const currentToken = this.getDecryptedAccessToken(store);
    const isExpired    = this.isTokenExpired(store);

    if (!store.needsTokenRefresh && currentToken && !isExpired) {
      return currentToken;
    }

    if (store.platform === StorePlatform.OTHER) {
      if (currentToken) return currentToken;
      throw new BadRequestException('مفتاح API المتجر غير موجود. يرجى إعادة ربط المتجر.');
    }

    const refreshToken = this.getDecryptedRefreshToken(store);

    if (!refreshToken || refreshToken.trim() === '') {
      this.logger.error(`❌ Store ${store.id} (${store.platform}) has no refresh token`);
      store.status      = StoreStatus.TOKEN_EXPIRED;
      store.lastError   = 'Token expired — no refresh token available';
      store.lastErrorAt = new Date();
      await this.storeRepository.save(store);
      throw new BadRequestException('انتهت صلاحية مفتاح API. يرجى إعادة ربط المتجر.');
    }

    this.logger.log(`Refreshing token for store: ${store.id} (${store.platform})`);

    try {
      let tokens: any;

      if (store.platform === StorePlatform.SALLA) {
        tokens = await this.sallaOAuthService.refreshAccessToken(refreshToken);
        store.tokenExpiresAt = this.sallaOAuthService.calculateTokenExpiry(tokens.expires_in);

      } else if (store.platform === StorePlatform.ZID) {
        tokens = await this.zidOAuthService.refreshAccessToken(refreshToken);
        store.tokenExpiresAt = this.zidOAuthService.calculateTokenExpiry(tokens.expires_in);

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

      this.encryptTokens(store, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
      store.lastTokenRefreshAt = new Date();
      store.consecutiveErrors  = 0;

      await this.storeRepository.save(store);
      this.logger.log(`✅ Token refreshed for store ${store.id} (${store.platform})`);

      return tokens.access_token;

    } catch (error: any) {
      store.status            = StoreStatus.TOKEN_EXPIRED;
      store.lastError         = error instanceof Error ? error.message : 'Token refresh failed';
      store.lastErrorAt       = new Date();
      store.consecutiveErrors += 1;
      await this.storeRepository.save(store);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 Statistics (يقرأ من DB cache — لا API calls)
  // ═══════════════════════════════════════════════════════════════════════════

  async getStoreStats(store: Store): Promise<{ orders: number; products: number; customers: number }> {
    const stats = { orders: 0, products: 0, customers: 0 };

    if (store.status !== StoreStatus.ACTIVE) return stats;

    if (store.platform === StorePlatform.SALLA) {
      stats.orders    = store.sallaOrdersCount   ?? 0;
      stats.products  = store.sallaProductsCount ?? 0;
      stats.customers = store.sallaCustomersCount ?? 0;
      return stats;
    }

    if (store.platform === StorePlatform.ZID) {
      stats.orders    = store.zidOrdersCount   ?? 0;
      stats.products  = store.zidProductsCount ?? 0;
      stats.customers = store.zidCustomersCount ?? 0;
      return stats;
    }

    return stats;
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

    const byStatus:   Record<string, number> = {};
    const byPlatform: Record<string, number> = {};

    for (const store of stores) {
      byStatus[store.status]     = (byStatus[store.status] || 0) + 1;
      byPlatform[store.platform] = (byPlatform[store.platform] || 0) + 1;
    }

    return { total: stores.length, byStatus, byPlatform };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔌 Disconnect & Delete
  // ═══════════════════════════════════════════════════════════════════════════

  async disconnectStore(tenantId: string, storeId: string): Promise<void> {
    const store = await this.findById(tenantId, storeId);

    store.status         = StoreStatus.DISCONNECTED;
    store.accessToken    = undefined;
    store.refreshToken   = undefined;
    store.tokenExpiresAt = undefined;

    await this.storeRepository.save(store);

    this.eventEmitter.emit('store.disconnected', {
      storeId: store.id, tenantId, platform: store.platform,
      merchantId: store.sallaMerchantId, zidStoreId: store.zidStoreId,
    });

    this.logger.log(`Store disconnected: ${store.id}`);
  }

  async deleteStorePermanently(tenantId: string, storeId: string): Promise<void> {
    const store = await this.findById(tenantId, storeId);

    this.eventEmitter.emit('store.deleted', {
      storeId: store.id, tenantId, platform: store.platform,
      merchantId: store.sallaMerchantId, zidStoreId: store.zidStoreId,
    });

    store.status         = StoreStatus.UNINSTALLED;
    store.accessToken    = undefined;
    store.refreshToken   = undefined;
    store.tokenExpiresAt = undefined;

    await this.storeRepository.save(store);
    await this.storeRepository.softRemove(store);

    this.logger.log(`Store soft-deleted: ${storeId}`);
  }

  async recordError(storeId: string, error: string): Promise<void> {
    await this.storeRepository.update(storeId, {
      lastError: error, lastErrorAt: new Date(),
      consecutiveErrors: () => 'consecutive_errors + 1',
    });
  }

  async clearErrors(storeId: string): Promise<void> {
    await this.storeRepository.update(storeId, { lastError: undefined, consecutiveErrors: 0 });
  }
}
