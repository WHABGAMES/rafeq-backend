/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Service                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

// Services
import { SallaOAuthService, SallaMerchantInfo } from './salla-oauth.service';

interface ConnectSallaStoreData {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  merchantInfo: SallaMerchantInfo;
}

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    private readonly sallaOAuthService: SallaOAuthService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
        return this.updateStoreConnection(existingStore, tokens, merchantInfo);
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

    this.logger.log(`Store connected: ${savedStore.name}`, {
      storeId: savedStore.id,
      tenantId,
      merchantId: merchantInfo.id,
    });

    return savedStore;
  }

  private async updateStoreConnection(
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

  async ensureValidToken(store: Store): Promise<string> {
    if (!store.needsTokenRefresh && store.accessToken) {
      return store.accessToken;
    }

    this.logger.log(`Refreshing token for store: ${store.id}`);

    try {
      const tokens = await this.sallaOAuthService.refreshAccessToken(store.refreshToken!);

      store.accessToken = tokens.access_token;
      store.refreshToken = tokens.refresh_token;
      store.tokenExpiresAt = this.sallaOAuthService.calculateTokenExpiry(tokens.expires_in);
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
}
