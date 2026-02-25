/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM — Zid Store Service                                ║
 * ║                                                                                ║
 * ║  مسؤولية هذا الملف: كل ما يخص منصة زد فقط                                   ║
 * ║  ─────────────────────────────────────────────────────────────                ║
 * ║  ✅ ربط متجر زد                   connectZidStore()                           ║
 * ║  ✅ البحث بـ storeId / storeUuid   findByZidStoreId() / findByZidStoreUuid()  ║
 * ║  ✅ مزامنة بيانات زد               syncZidStore()                             ║
 * ║  ✅ بناء توكنات زد                 getZidTokens()                             ║
 * ║                                                                                ║
 * ║  ⚠️  هذا الملف لا يحتوي على أي كود خاص بـ Salla                             ║
 * ║     التعديل هنا لا يؤثر على نظام Salla بأي شكل                              ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/zid-store.service.ts                                  ║
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
import { ConfigService } from '@nestjs/config';

import { encrypt, decryptSafe, isEncrypted } from '@common/utils/encryption.util';
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';
import { ZidStoreInfo } from './zid-oauth.service';
import { ZidApiService, ZidAuthTokens } from './zid-api.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectZidStoreData {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    authorization?: string;
  };
  storeInfo: ZidStoreInfo;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ZidStoreService {
  private readonly logger = new Logger(ZidStoreService.name);

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,

    private readonly zidApiService: ZidApiService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔗 ربط المتجر
  // ═══════════════════════════════════════════════════════════════════════════

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

    store.accessToken  = encrypt(tokens.accessToken)  ?? undefined;
    store.refreshToken = encrypt(tokens.refreshToken) ?? undefined;

    const savedStore = await this.storeRepository.save(store);

    // ✅ تسجيل Zid webhooks بعد الربط من الداشبورد
    try {
      const baseUrl =
        this.configService.get<string>('app.baseUrl') ||
        this.configService.get<string>('APP_BASE_URL') ||
        'https://api.rafeq.ai';
      const webhookUrl = `${baseUrl}/api/webhooks/zid`;
      const appId = this.configService.get<string>('zid.clientId') || 'rafeq-app';

      const result = await this.zidApiService.registerWebhooks(
        { managerToken: tokens.accessToken, authorizationToken: tokens.authorization || undefined },
        webhookUrl,
        appId,
      );
      this.logger.log(`🔔 Zid webhooks registered: ${result.registered.join(',')}`);
    } catch (error: any) {
      this.logger.warn(`⚠️ Webhook registration failed (non-fatal): ${error.message}`);
    }

    this.eventEmitter.emit('store.connected', {
      storeId: savedStore.id,
      tenantId,
      platform: StorePlatform.ZID,
      zidStoreId: storeInfo.id,
    });

    this.logger.log(`✅ Zid store connected: ${savedStore.name}`, {
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
    store.accessToken    = encrypt(tokens.accessToken)  ?? undefined;
    store.refreshToken   = encrypt(tokens.refreshToken) ?? undefined;
    store.tokenExpiresAt = tokens.expiresAt;
    store.status         = StoreStatus.ACTIVE;
    store.lastSyncedAt   = new Date();
    store.consecutiveErrors = 0;
    store.lastError      = undefined;
    store.zidStoreName   = storeInfo.name;
    store.zidEmail       = storeInfo.email;
    store.zidMobile      = storeInfo.mobile;
    store.zidDomain      = storeInfo.url;
    store.zidLogo        = storeInfo.logo;
    store.zidCurrency    = storeInfo.currency;
    store.zidLanguage    = storeInfo.language;

    // تحديث authorization token
    if (tokens.authorization) {
      store.settings = {
        ...(store.settings || {}),
        zidAuthorizationToken: encrypt(tokens.authorization),
      };
    } else {
      // ✅ مسح التوكن القديم لمنع 401 errors
      const { zidAuthorizationToken: _removed, ...otherSettings } = (store.settings as any) || {};
      store.settings = otherSettings;
      this.logger.warn(`⚠️ No authorization token from Zid — cleared old token for store ${store.zidStoreId}`);
    }

    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔍 البحث
  // ═══════════════════════════════════════════════════════════════════════════

  async findByZidStoreId(zidStoreId: string): Promise<Store | null> {
    return this.storeRepository.findOne({ where: { zidStoreId } });
  }

  /**
   * البحث بـ UUID (fallback عندما لا يكون store_id موجوداً)
   */
  async findByZidStoreUuid(zidStoreUuid: string): Promise<Store | null> {
    return this.storeRepository.findOne({ where: { zidStoreUuid } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔄 مزامنة المتجر
  // ═══════════════════════════════════════════════════════════════════════════

  async syncZidStore(store: Store, accessToken: string): Promise<void> {
    this.logger.debug(`Syncing Zid store: ${store.zidStoreId}`);

    try {
      const zidTokens = this.buildZidTokens(store, accessToken);

      // مزامنة معلومات المتجر
      const storeInfo = await this.zidApiService.getStoreInfo(zidTokens);

      store.zidStoreName = storeInfo.name;
      store.zidEmail     = storeInfo.email;
      store.zidMobile    = storeInfo.mobile;
      store.zidDomain    = storeInfo.url;
      store.zidLogo      = storeInfo.logo;
      store.zidCurrency  = storeInfo.currency;
      store.zidLanguage  = storeInfo.language;
      store.name         = storeInfo.name || store.name;

      // مزامنة الإحصائيات — تُخزَّن في DB لتجنب API calls عند كل تحميل
      const [ordersRes, productsRes, customersRes] = await Promise.allSettled([
        this.zidApiService.getOrders(zidTokens,    { page: 1, per_page: 1 }),
        this.zidApiService.getProducts(zidTokens,  { page: 1, per_page: 1 }),
        this.zidApiService.getCustomers(zidTokens, { page: 1, per_page: 1 }),
      ]);

      if (ordersRes.status === 'fulfilled') {
        const total = ordersRes.value.pagination?.total;
        if (typeof total === 'number') store.zidOrdersCount = total;
        else this.logger.warn(`⚠️ Zid orders missing pagination.total for store ${store.id}`);
      }

      if (productsRes.status === 'fulfilled') {
        const total = productsRes.value.pagination?.total;
        if (typeof total === 'number') store.zidProductsCount = total;
        else this.logger.warn(`⚠️ Zid products missing pagination.total for store ${store.id}`);
      }

      if (customersRes.status === 'fulfilled') {
        const total = customersRes.value.pagination?.total;
        if (typeof total === 'number') store.zidCustomersCount = total;
        else this.logger.warn(`⚠️ Zid customers missing pagination.total for store ${store.id}`);
      }

      store.zidLastSyncAt = new Date();

      this.logger.log(`✅ Zid store synced: ${storeInfo.name}`, {
        storeId:   store.id,
        orders:    store.zidOrdersCount,
        products:  store.zidProductsCount,
        customers: store.zidCustomersCount,
      });

    } catch (error: any) {
      this.logger.error(`Failed to sync Zid store ${store.id}`, error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔑 مساعدات التوكنات
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * بناء ZidAuthTokens من المتجر المحفوظ
   * زد يحتاج headerين: Authorization (Bearer) + X-Manager-Token
   */
  buildZidTokens(store: Store, managerToken: string): ZidAuthTokens {
    const storedAuth = (store.settings as any)?.zidAuthorizationToken;
    let authorizationToken: string | null = null;

    if (storedAuth) {
      authorizationToken = isEncrypted(storedAuth)
        ? decryptSafe(storedAuth)
        : storedAuth;
    }

    if (!authorizationToken) {
      this.logger.warn(`⚠️ Zid store ${store.id} has no authorization token — using access token only`);
    }

    return {
      managerToken,
      authorizationToken: authorizationToken || undefined,
      storeId: store.zidStoreId || undefined,
    };
  }
}
