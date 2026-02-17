/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid OAuth Service                              ║
 * ║                                                                                ║
 * ║  ✅ OAuth 2.0 Flow مع زد                                                        ║
 * ║  ✅ يدعم Dashboard Mode (ربط متجر لحساب موجود)                                ║
 * ║  ✅ يدعم Auto Registration (تثبيت من متجر زد بدون حساب)                        ║
 * ║  ✅ Multi-Store — تاجر موجود يُربط متجره الجديد على نفس tenant                 ║
 * ║  🔐 تشفير التوكنات بـ AES-256-GCM                                               ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/zid-oauth.service.ts                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

// Entities
import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

// Services
import { TenantsService } from '../tenants/tenants.service';
import { AutoRegistrationService } from '../auth/auto-registration.service';

// 🔐 Encryption
import { encrypt } from '@common/utils/encryption.util';

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Exported Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface ZidTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface ZidStoreInfo {
  id: string;
  uuid: string;
  name: string;
  email: string;
  /** ⚠️ optional: Zid قد لا يرجع رقم جوال */
  mobile?: string;
  url: string;
  logo?: string;
  currency: string;
  language: string;
  created_at: string;
}

@Injectable()
export class ZidOAuthService {
  private readonly logger = new Logger(ZidOAuthService.name);

  // Zid OAuth endpoints
  private readonly ZID_AUTH_URL = 'https://oauth.zid.sa/oauth/authorize';
  private readonly ZID_TOKEN_URL = 'https://oauth.zid.sa/oauth/token';
  private readonly ZID_API_URL = 'https://api.zid.sa/v1';

  // State storage
  private readonly stateStorage = new Map<string, { tenantId: string; expiresAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly tenantsService: TenantsService,
    private readonly autoRegistrationService: AutoRegistrationService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 OAuth URL Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إنشاء رابط OAuth لزد
   */
  generateAuthorizationUrl(tenantId: string): string {
    const state = this.generateState(tenantId);

    const clientId = this.configService.get<string>('zid.clientId');
    const redirectUri = this.configService.get<string>('zid.oauthCallbackUrl');

    if (!clientId) {
      throw new BadRequestException('Zid Client ID غير مهيأ');
    }

    if (!redirectUri) {
      throw new BadRequestException('Zid Redirect URI غير مهيأ');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'offline_access',
      state: state,
    });

    const authUrl = `${this.ZID_AUTH_URL}?${params.toString()}`;

    this.logger.debug('Generated Zid OAuth URL', { tenantId, state });

    return authUrl;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 Token Exchange — Dashboard Mode (with state)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * استبدال Authorization Code بـ Access Token
   */
  async exchangeCodeForTokens(
    code: string,
    state: string,
  ): Promise<{ tokens: ZidTokenResponse; tenantId: string }> {
    const tenantId = this.validateState(state);

    const clientId = this.configService.get<string>('zid.clientId');
    const clientSecret = this.configService.get<string>('zid.clientSecret');
    const redirectUri = this.configService.get<string>('zid.oauthCallbackUrl');

    if (!clientId || !clientSecret) {
      throw new BadRequestException('إعدادات زد غير مكتملة');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<ZidTokenResponse>(
          this.ZID_TOKEN_URL,
          {
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code: code,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );

      this.logger.log('Successfully exchanged code for Zid tokens', { tenantId });

      return { tokens: response.data, tenantId };
    } catch (error: any) {
      this.logger.error('Failed to exchange Zid code for tokens', {
        error: error?.response?.data || error.message,
      });
      throw new UnauthorizedException('فشل في الحصول على tokens من زد');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 Auto Registration — تثبيت من متجر زد (بدون state/tenantId)
  // ✅ نفس آلية سلة: resolveOrCreateTenant + handleAppInstallation
  // ═══════════════════════════════════════════════════════════════════════════════

  async exchangeCodeAndAutoRegister(code: string): Promise<{
    zidStoreId: string;
    isNewUser: boolean;
    email: string;
  }> {
    this.logger.log('🆕 exchangeCodeAndAutoRegister — Zid store install');

    const clientId = this.configService.get<string>('zid.clientId');
    const clientSecret = this.configService.get<string>('zid.clientSecret');
    const redirectUri = this.configService.get<string>('zid.oauthCallbackUrl');

    if (!clientId || !clientSecret) {
      throw new BadRequestException('إعدادات زد غير مكتملة');
    }

    try {
      // 1. استبدال code بـ tokens
      const response = await firstValueFrom(
        this.httpService.post<ZidTokenResponse>(
          this.ZID_TOKEN_URL,
          {
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );

      const tokens = response.data;

      // 2. جلب بيانات المتجر
      const storeInfo = await this.getStoreInfo(tokens.access_token);
      this.logger.log(`📊 Zid Store: ${storeInfo.id} — ${storeInfo.name}`);

      // 3. البحث عن متجر موجود أو إنشاء جديد
      let store = await this.storeRepository.findOne({
        where: { zidStoreId: storeInfo.id },
      });

      if (store) {
        // متجر موجود (نفس zidStoreId) — تحديث التوكنات
        store.accessToken = encrypt(tokens.access_token) ?? undefined;
        store.refreshToken = encrypt(tokens.refresh_token) ?? undefined;
        store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
        store.lastTokenRefreshAt = new Date();
        store.status = StoreStatus.ACTIVE;
        store.consecutiveErrors = 0;
        store.lastError = undefined;
        store.zidStoreName = storeInfo.name || store.zidStoreName;
        store.zidEmail = storeInfo.email || store.zidEmail;
        store.zidMobile = storeInfo.mobile || store.zidMobile;
        store.zidDomain = storeInfo.url || store.zidDomain;
        store.zidLogo = storeInfo.logo || store.zidLogo;
        store.zidCurrency = storeInfo.currency || store.zidCurrency;
        store.zidLanguage = storeInfo.language || store.zidLanguage;

        if (!store.tenantId) {
          const tenantId = await this.resolveOrCreateTenant(storeInfo);
          store.tenantId = tenantId;
        }

        this.logger.log(`📦 Updated existing Zid store: ${store.id}`);
      } else {
        // ✅ متجر جديد — نتحقق هل التاجر موجود بالإيميل أولاً
        const tenantId = await this.resolveOrCreateTenant(storeInfo);

        store = this.storeRepository.create({
          tenantId,
          name: storeInfo.name || `متجر زد ${storeInfo.id}`,
          platform: StorePlatform.ZID,
          status: StoreStatus.ACTIVE,
          zidStoreId: storeInfo.id,
          zidStoreUuid: storeInfo.uuid,
          accessToken: encrypt(tokens.access_token) ?? undefined,
          refreshToken: encrypt(tokens.refresh_token) ?? undefined,
          tokenExpiresAt: this.calculateTokenExpiry(tokens.expires_in),
          zidStoreName: storeInfo.name,
          zidEmail: storeInfo.email,
          zidMobile: storeInfo.mobile,
          zidDomain: storeInfo.url,
          zidLogo: storeInfo.logo,
          zidCurrency: storeInfo.currency,
          zidLanguage: storeInfo.language,
          lastSyncedAt: new Date(),
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
        });

        this.logger.log(`🆕 Created new Zid store: ${storeInfo.id} → tenant ${tenantId}`);
      }

      const savedStore = await this.storeRepository.save(store);

      // 4. إنشاء/تحديث المستخدم + إرسال بيانات الدخول
      let isNewUser = false;
      try {
        const regResult = await this.autoRegistrationService.handleAppInstallation(
          {
            merchantId: parseInt(storeInfo.id) || 0,
            email: storeInfo.email,
            mobile: storeInfo.mobile,
            name: storeInfo.name || 'تاجر',
            storeName: storeInfo.name,
            avatar: storeInfo.logo,
            platform: 'zid',
          },
          savedStore,
        );
        isNewUser = regResult.isNewUser;

        this.logger.log(`✅ Zid Auto-registration: ${regResult.message}`, {
          userId: regResult.userId,
          isNewUser: regResult.isNewUser,
        });
      } catch (error: any) {
        this.logger.error(`❌ Zid Auto-registration failed: ${error.message}`, {
          zidStoreId: storeInfo.id,
          email: storeInfo.email,
        });
      }

      return {
        zidStoreId: storeInfo.id,
        isNewUser,
        email: storeInfo.email,
      };

    } catch (error: any) {
      this.logger.error('Failed exchangeCodeAndAutoRegister (Zid)', {
        error: error?.response?.data || error.message,
      });
      throw new BadRequestException('Failed to complete Zid store installation');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Refresh
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<ZidTokenResponse> {
    const clientId = this.configService.get<string>('zid.clientId');
    const clientSecret = this.configService.get<string>('zid.clientSecret');

    try {
      const response = await firstValueFrom(
        this.httpService.post<ZidTokenResponse>(
          this.ZID_TOKEN_URL,
          {
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );

      this.logger.log('Successfully refreshed Zid access token');
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to refresh Zid token', {
        error: error?.response?.data || error.message,
      });
      throw new UnauthorizedException('فشل في تجديد token زد');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Store Info
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStoreInfo(accessToken: string): Promise<ZidStoreInfo> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.ZID_API_URL}/managers/account`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Accept-Language': 'ar',
          },
        }),
      );

      const data = response.data?.store || response.data;

      this.logger.log('Successfully fetched Zid store info', {
        storeId: data.id,
        storeName: data.name,
      });

      return {
        id: data.id?.toString() || data.uuid,
        uuid: data.uuid || data.id?.toString(),
        name: data.name || data.title,
        email: data.email || '',
        mobile: data.mobile || data.phone || '',
        url: data.url || data.domain || '',
        logo: data.logo || data.image,
        currency: data.currency || 'SAR',
        language: data.language || 'ar',
        created_at: data.created_at || new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch Zid store info', {
        error: error?.response?.data || error.message,
      });
      throw new BadRequestException('فشل في جلب بيانات المتجر من زد');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ البحث عن tenant موجود أو إنشاء جديد
  // نفس آلية سلة — البحث بالإيميل أولاً
  // ═══════════════════════════════════════════════════════════════════════════════

  private async resolveOrCreateTenant(storeInfo: ZidStoreInfo): Promise<string> {
    // 🔍 البحث عن المستخدم بالإيميل
    if (storeInfo.email) {
      const existingUser = await this.autoRegistrationService.findUserByEmail(storeInfo.email);

      if (existingUser?.tenantId) {
        this.logger.log(
          `👤 Existing user found (${existingUser.id}) → reusing tenant ${existingUser.tenantId} for Zid store ${storeInfo.id}`,
        );
        return existingUser.tenantId;
      }
    }

    // 🆕 مستخدم جديد → إنشاء tenant جديد
    const tenant = await this.tenantsService.createTenantFromSalla({
      merchantId: parseInt(storeInfo.id) || 0,
      name: storeInfo.name || 'متجر زد',
      email: storeInfo.email,
      phone: storeInfo.mobile,
      logo: storeInfo.logo,
      website: storeInfo.url,
    });

    this.logger.log(`🆕 Created new tenant ${tenant.id} for Zid store ${storeInfo.id}`);
    return tenant.id;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 State Management
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateState(tenantId: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    this.stateStorage.set(state, {
      tenantId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    this.cleanupExpiredStates();
    return state;
  }

  /**
   * التحقق من state — يرجع tenantId إذا صالح
   * يرجع null إذا غير صالح (بدل throw) — للاستخدام في الـ controller
   */
  validateState(state: string): string {
    const stored = this.stateStorage.get(state);
    if (!stored) {
      throw new UnauthorizedException('State غير صالح');
    }
    if (Date.now() > stored.expiresAt) {
      this.stateStorage.delete(state);
      throw new UnauthorizedException('انتهت صلاحية الجلسة');
    }
    this.stateStorage.delete(state);
    return stored.tenantId;
  }

  /**
   * فحص هل الـ state صالح — بدون throw
   */
  isValidState(state: string): boolean {
    const stored = this.stateStorage.get(state);
    if (!stored) return false;
    if (Date.now() > stored.expiresAt) {
      this.stateStorage.delete(state);
      return false;
    }
    return true;
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of this.stateStorage.entries()) {
      if (now > data.expiresAt) {
        this.stateStorage.delete(state);
      }
    }
  }

  calculateTokenExpiry(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
  }
}
