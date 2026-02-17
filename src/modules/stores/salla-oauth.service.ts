/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Service                          ║
 * ║                                                                              ║
 * ║  ✅ OAuth 2.0 Flow مع سلة                                                       ║
 * ║  ✅ يدعم Easy Mode و Standard OAuth و Custom Mode                             ║
 * ║  ✅ Auto Registration - إنشاء حساب تلقائي للتاجر                               ║
 * ║  ✅ Multi-Store — تاجر موجود يُربط متجره الجديد على نفس tenant                 ║
 * ║  🔐 NEW: تشفير التوكنات بـ AES-256-GCM                                         ║
 * ║                                                                              ║
 * ║  📁 src/modules/stores/salla-oauth.service.ts                                ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';

import { Store, StoreStatus, StorePlatform } from './entities/store.entity';
import { AutoRegistrationService } from '../auth/auto-registration.service';

// 🔐 Encryption
import { encrypt } from '@common/utils/encryption.util';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Exported Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * ✅ معلومات التاجر من سلة API
 */
export interface SallaMerchantInfo {
  id: number;
  name: string;
  username?: string;
  email: string;
  /** ⚠️ optional: سلة أحياناً ما ترجع رقم جوال (مثل المتجر التجريبي) */
  mobile?: string;
  domain: string;
  plan: string;
  avatar?: string;
}

export interface OAuthResult {
  tokens: SallaTokenResponse;
  tenantId: string;
  merchantId: number;
}

/**
 * ✅ بيانات app.store.authorize من webhook سلة
 */
export interface SallaAppAuthorizeData {
  access_token: string;
  refresh_token: string;
  expires: number;
  scope: string;
}

@Injectable()
export class SallaOAuthService {
  private readonly logger = new Logger(SallaOAuthService.name);
  
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly sallaAuthUrl = 'https://accounts.salla.sa/oauth2/auth';
  private readonly sallaTokenUrl = 'https://accounts.salla.sa/oauth2/token';
  private readonly sallaApiUrl = 'https://api.salla.dev/admin/v2';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly tenantsService: TenantsService,
    private readonly autoRegistrationService: AutoRegistrationService,
  ) {
    this.clientId = this.configService.getOrThrow<string>('SALLA_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('SALLA_CLIENT_SECRET');
    this.redirectUri = this.configService.getOrThrow<string>('SALLA_REDIRECT_URI');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 OAuth URL Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  generateAuthorizationUrl(tenantId: string, customState?: string): string {
    // 🔧 FIX H-01: HMAC-signed state parameter to prevent CSRF
    const stateData = {
      tenantId,
      custom: customState || '',
      ts: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(stateData)).toString('base64url');
    const secret = this.configService.get('JWT_SECRET', '');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encoded)
      .digest('hex');
    const state = `${encoded}.${signature}`;

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'offline_access',
      state,
    });

    const url = `${this.sallaAuthUrl}?${params.toString()}`;
    this.logger.log(`Generated OAuth URL for tenant ${tenantId}`);
    return url;
  }

  decodeState(state: string): { tenantId: string; custom: string } {
    try {
      // 🔧 FIX H-01: Verify HMAC signature before decoding
      const [encoded, signature] = state.split('.');
      if (!encoded || !signature) {
        throw new Error('Invalid state format');
      }

      const secret = this.configService.get('JWT_SECRET', '');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(encoded)
        .digest('hex');

      // Timing-safe comparison
      if (signature.length !== expectedSignature.length ||
          !crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex'),
          )) {
        throw new Error('Invalid state signature');
      }

      // Verify timestamp (10 minute window)
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      const MAX_AGE = 10 * 60 * 1000;
      if (Date.now() - decoded.ts > MAX_AGE) {
        throw new Error('State parameter expired');
      }

      return { tenantId: decoded.tenantId, custom: decoded.custom || '' };
    } catch (error) {
      // ✅ FIX: DEBUG وليس ERROR — state من سلة (غير موقّع) هو سلوك متوقع
      // يحدث عند تثبيت التطبيق من متجر سلة (وليس من الداشبورد)
      this.logger.debug('State is not HMAC-signed — likely Salla-generated state');
      throw new BadRequestException('Invalid or expired state parameter');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 Token Exchange
  // ═══════════════════════════════════════════════════════════════════════════════

  async exchangeCodeForTokens(code: string, tenantId: string): Promise<OAuthResult> {
    this.logger.log('Exchanging code for tokens');

    try {
      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          this.sallaTokenUrl,
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            code,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      const tokens = response.data;
      const merchantInfo = await this.fetchMerchantInfo(tokens.access_token);

      let store = await this.storeRepository.findOne({ where: { sallaMerchantId: merchantInfo.id } });

      if (store) {
        store.tenantId = tenantId;
        // 🔐 تشفير التوكنات
        store.accessToken = encrypt(tokens.access_token) ?? undefined;
        store.refreshToken = encrypt(tokens.refresh_token) ?? undefined;
        store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
        store.lastTokenRefreshAt = new Date();
        store.status = StoreStatus.ACTIVE;
        store.consecutiveErrors = 0;
        store.lastError = undefined;
        
        store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
        store.sallaEmail = merchantInfo.email || store.sallaEmail;
        store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
        store.sallaDomain = merchantInfo.domain || store.sallaDomain;
        store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
        store.sallaPlan = merchantInfo.plan || store.sallaPlan;
        
        this.logger.log(`Updated existing store: ${store.id}`);
      } else {
        store = this.storeRepository.create({
          tenantId,
          name: merchantInfo.name || merchantInfo.username || `متجر سلة ${merchantInfo.id}`,
          platform: StorePlatform.SALLA,
          status: StoreStatus.ACTIVE,
          sallaMerchantId: merchantInfo.id,
          // 🔐 تشفير التوكنات
          accessToken: encrypt(tokens.access_token) ?? undefined,
          refreshToken: encrypt(tokens.refresh_token) ?? undefined,
          tokenExpiresAt: this.calculateTokenExpiry(tokens.expires_in),
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
          lastSyncedAt: new Date(),
          settings: {},
          subscribedEvents: [],
        });

        this.logger.log(`Created new store for merchant ${merchantInfo.id}`);
      }

      await this.storeRepository.save(store);

      this.logger.log(`OAuth completed for tenant ${tenantId}, merchant ${merchantInfo.id}`);

      return {
        tokens,
        tenantId,
        merchantId: merchantInfo.id,
      };
    } catch (error: any) {
      this.logger.error('Failed to exchange code for tokens', { error: error.response?.data || error.message });
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 Custom Mode — تثبيت من متجر سلة (بدون tenantId)
  // ✅ FIX: إذا التاجر موجود بالإيميل → نستخدم tenant-ه الحالي
  // ═══════════════════════════════════════════════════════════════════════════════

  async exchangeCodeAndAutoRegister(code: string): Promise<{
    merchantId: number;
    isNewUser: boolean;
    email: string;
  }> {
    this.logger.log('🆕 exchangeCodeAndAutoRegister — Salla store install');

    try {
      // 1. استبدال code بـ tokens
      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          this.sallaTokenUrl,
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            code,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      const tokens = response.data;

      // 2. جلب بيانات التاجر
      const merchantInfo = await this.fetchMerchantInfo(tokens.access_token);
      this.logger.log(`📊 Merchant: ${merchantInfo.id} — ${merchantInfo.name}`);

      // 3. البحث عن متجر موجود أو إنشاء جديد
      let store = await this.storeRepository.findOne({
        where: { sallaMerchantId: merchantInfo.id },
      });

      if (store) {
        // متجر موجود (نفس merchantId) — تحديث التوكنات فقط
        store.accessToken = encrypt(tokens.access_token) ?? undefined;
        store.refreshToken = encrypt(tokens.refresh_token) ?? undefined;
        store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
        store.lastTokenRefreshAt = new Date();
        store.status = StoreStatus.ACTIVE;
        store.consecutiveErrors = 0;
        store.lastError = undefined;
        store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
        store.sallaEmail = merchantInfo.email || store.sallaEmail;
        store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
        store.sallaDomain = merchantInfo.domain || store.sallaDomain;
        store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
        store.sallaPlan = merchantInfo.plan || store.sallaPlan;

        // إذا ما عنده tenant → نحل المشكلة
        if (!store.tenantId) {
          const tenantId = await this.resolveOrCreateTenant(merchantInfo);
          store.tenantId = tenantId;
        }

        this.logger.log(`📦 Updated existing store: ${store.id}`);
      } else {
        // ✅ FIX: متجر جديد — نتحقق هل التاجر موجود بالإيميل أولاً
        const tenantId = await this.resolveOrCreateTenant(merchantInfo);

        store = this.storeRepository.create({
          tenantId,
          name: merchantInfo.name || merchantInfo.username || `متجر سلة ${merchantInfo.id}`,
          platform: StorePlatform.SALLA,
          status: StoreStatus.ACTIVE,
          sallaMerchantId: merchantInfo.id,
          accessToken: encrypt(tokens.access_token) ?? undefined,
          refreshToken: encrypt(tokens.refresh_token) ?? undefined,
          tokenExpiresAt: this.calculateTokenExpiry(tokens.expires_in),
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
          lastSyncedAt: new Date(),
          settings: {},
          subscribedEvents: [],
        });

        this.logger.log(`🆕 Created new store for merchant ${merchantInfo.id} → tenant ${tenantId}`);
      }

      const savedStore = await this.storeRepository.save(store);

      // 4. إنشاء/تحديث المستخدم + إرسال بيانات الدخول (إيميل + واتساب)
      let isNewUser = false;
      try {
        const regResult = await this.autoRegistrationService.handleAppInstallation(
          {
            merchantId: merchantInfo.id,
            email: merchantInfo.email,
            mobile: merchantInfo.mobile,
            name: merchantInfo.name || merchantInfo.username || 'تاجر',
            storeName: merchantInfo.name,
            avatar: merchantInfo.avatar,
            platform: 'salla',
          },
          savedStore,
        );
        isNewUser = regResult.isNewUser;

        this.logger.log(`✅ Auto-registration: ${regResult.message}`, {
          userId: regResult.userId,
          isNewUser: regResult.isNewUser,
        });
      } catch (error: any) {
        this.logger.error(`❌ Auto-registration failed: ${error.message}`, {
          merchantId: merchantInfo.id,
          email: merchantInfo.email,
        });
      }

      return {
        merchantId: merchantInfo.id,
        isNewUser,
        email: merchantInfo.email,
      };

    } catch (error: any) {
      this.logger.error('Failed exchangeCodeAndAutoRegister', {
        error: error.response?.data || error.message,
      });
      throw new BadRequestException('Failed to complete Salla store installation');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Merchant Info
  // ═══════════════════════════════════════════════════════════════════════════════

  async fetchMerchantInfo(accessToken: string): Promise<SallaMerchantInfo> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.sallaApiUrl}/store/info`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      const data = response.data.data;
      return {
        id: data.id,
        name: data.name,
        username: data.username,
        email: data.email,
        mobile: data.mobile,
        domain: data.domain,
        plan: data.plan,
        avatar: data.avatar,
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch merchant info', error.message);
      throw new BadRequestException('Failed to fetch merchant information');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Refresh
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<SallaTokenResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          this.sallaTokenUrl,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      this.logger.log('Access token refreshed successfully');
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to refresh token', error.message);
      throw new BadRequestException('Failed to refresh access token');
    }
  }

  public calculateTokenExpiry(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Easy Mode - Webhook Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ معالجة app.store.authorize من webhook سلة
   * ✅ FIX: إذا التاجر موجود → نستخدم tenant-ه الحالي بدل إنشاء جديد
   */
  async handleAppStoreAuthorize(
    merchantId: number,
    data: SallaAppAuthorizeData,
    createdAt: string,
  ): Promise<Store> {
    this.logger.log(`🚀 App Store authorize for merchant ${merchantId}`, { createdAt });

    const merchantInfo = await this.fetchMerchantInfo(data.access_token);
    let store = await this.storeRepository.findOne({ where: { sallaMerchantId: merchantId } });
    const expiresIn = data.expires || 3600;

    if (store) {
      // متجر موجود (نفس merchantId) — تحديث التوكنات
      if (!store.tenantId) {
        const tenantId = await this.resolveOrCreateTenant(merchantInfo);
        store.tenantId = tenantId;
      }
      
      // 🔐 تشفير التوكنات
      store.accessToken = encrypt(data.access_token) ?? undefined;
      store.refreshToken = encrypt(data.refresh_token) ?? undefined;
      store.tokenExpiresAt = this.calculateTokenExpiry(expiresIn);
      store.lastTokenRefreshAt = new Date();
      store.status = StoreStatus.ACTIVE;
      store.consecutiveErrors = 0;
      store.lastError = undefined;
      store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
      store.sallaEmail = merchantInfo.email || store.sallaEmail;
      store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
      store.sallaDomain = merchantInfo.domain || store.sallaDomain;
      store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
      store.sallaPlan = merchantInfo.plan || store.sallaPlan;
      
      this.logger.log(`📦 Updated store for merchant ${merchantId}`);
    } else {
      // ✅ FIX: متجر جديد — نتحقق هل التاجر موجود أولاً
      const tenantId = await this.resolveOrCreateTenant(merchantInfo);

      store = this.storeRepository.create({
        tenantId,
        name: merchantInfo.name || merchantInfo.username || `متجر سلة`,
        platform: StorePlatform.SALLA,
        status: StoreStatus.ACTIVE,
        sallaMerchantId: merchantId,
        // 🔐 تشفير التوكنات
        accessToken: encrypt(data.access_token) ?? undefined,
        refreshToken: encrypt(data.refresh_token) ?? undefined,
        tokenExpiresAt: this.calculateTokenExpiry(expiresIn),
        sallaStoreName: merchantInfo.name,
        sallaEmail: merchantInfo.email,
        sallaMobile: merchantInfo.mobile,
        sallaDomain: merchantInfo.domain,
        sallaAvatar: merchantInfo.avatar,
        sallaPlan: merchantInfo.plan,
        lastSyncedAt: new Date(),
        settings: {},
        subscribedEvents: [],
      });

      this.logger.log(`🆕 Created new store for merchant ${merchantId} → tenant ${tenantId}`);
    }

    const savedStore = await this.storeRepository.save(store);

    // 👤 إنشاء/تحديث المستخدم + إرسال بيانات الدخول
    try {
      const result = await this.autoRegistrationService.handleAppInstallation(
        {
          merchantId,
          email: merchantInfo.email,
          mobile: merchantInfo.mobile,
          name: merchantInfo.name || merchantInfo.username || 'تاجر',
          storeName: merchantInfo.name,
          avatar: merchantInfo.avatar,
          platform: 'salla',
        },
        savedStore,
      );

      this.logger.log(`✅ Auto-registration completed`, {
        merchantId,
        userId: result.userId,
        isNewUser: result.isNewUser,
        email: result.email,
      });
    } catch (error: any) {
      this.logger.error(`❌ Auto-registration failed: ${error.message}`, {
        merchantId,
        email: merchantInfo.email,
      });
    }

    return savedStore;
  }

  /**
   * ✅ معالجة app.uninstalled
   */
  async handleAppUninstalled(merchantId: number): Promise<void> {
    this.logger.log(`App uninstalled for merchant ${merchantId}`);
    const store = await this.storeRepository.findOne({ where: { sallaMerchantId: merchantId } });
    if (store) {
      store.status = StoreStatus.UNINSTALLED;
      store.accessToken = undefined;
      store.refreshToken = undefined;
      store.tokenExpiresAt = undefined;
      await this.storeRepository.save(store);
      this.logger.log(`Store uninstalled for merchant ${merchantId}`);
    }
  }

  /**
   * ✅ ربط متجر بـ tenant
   */
  async linkStoreToTenant(storeId: string, tenantId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new BadRequestException('Store not found');
    }
    store.tenantId = tenantId;
    this.logger.log(`Linked store ${storeId} to tenant ${tenantId}`);
    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX: البحث عن tenant موجود أو إنشاء جديد
  //
  // المنطق:
  // 1. البحث عن المستخدم بالإيميل
  // 2. إذا موجود وعنده tenantId → نستخدمه (المتجر الجديد يُربط على نفس الحساب)
  // 3. إذا جديد → ننشئ tenant جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  private async resolveOrCreateTenant(merchantInfo: SallaMerchantInfo): Promise<string> {
    // 🔍 البحث عن المستخدم بالإيميل
    if (merchantInfo.email) {
      const existingUser = await this.autoRegistrationService.findUserByEmail(merchantInfo.email);

      if (existingUser?.tenantId) {
        this.logger.log(
          `👤 Existing user found (${existingUser.id}) → reusing tenant ${existingUser.tenantId} for merchant ${merchantInfo.id}`,
        );
        return existingUser.tenantId;
      }
    }

    // 🆕 مستخدم جديد → إنشاء tenant جديد
    const tenant = await this.tenantsService.createTenantFromSalla({
      merchantId: merchantInfo.id,
      name: merchantInfo.name || merchantInfo.username || 'متجر سلة',
      email: merchantInfo.email,
      phone: merchantInfo.mobile,
      logo: merchantInfo.avatar,
      website: merchantInfo.domain,
    });

    this.logger.log(`🆕 Created new tenant ${tenant.id} for merchant ${merchantInfo.id}`);
    return tenant.id;
  }
}
