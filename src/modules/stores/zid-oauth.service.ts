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
 * ║  ✅ FIX (based on official Zid docs):                                           ║
 * ║     - Token response returns: access_token, authorization, refresh_token       ║
 * ║     - API headers: Authorization: Bearer {authorization}                       ║
 * ║                     X-Manager-Token: {access_token}                            ║
 * ║     - Endpoint: /managers/account/profile                                      ║
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
  /**
   * ✅ زد يرجع هذا الحقل الإضافي في الـ token response
   * حسب وثائق زد الرسمية:
   *   Authorization header ← authorization field
   *   X-Manager-Token header ← access_token field
   */
  authorization?: string;
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
  // ═══════════════════════════════════════════════════════════════════════════════

  async exchangeCodeAndAutoRegister(code: string): Promise<{
    zidStoreId: string;
    isNewUser: boolean;
    email: string;
  }> {
    this.logger.log('🆕 exchangeCodeAndAutoRegister — Zid store install [V2-FIX]');

    const clientId = this.configService.get<string>('zid.clientId');
    const clientSecret = this.configService.get<string>('zid.clientSecret');
    const redirectUri = this.configService.get<string>('zid.oauthCallbackUrl');

    if (!clientId || !clientSecret) {
      throw new BadRequestException('إعدادات زد غير مكتملة');
    }

    try {
      // ═══════════════════════════════════════════════════════════════════════
      // 1. استبدال code بـ tokens
      // ═══════════════════════════════════════════════════════════════════════
      const response = await firstValueFrom(
        this.httpService.post(
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

      const tokenData = response.data;

      // ✅ تسجيل كل حقول الـ token response (ضروري للتشخيص)
      this.logger.log('🔑 [V2] Zid token response keys:', {
        allKeys: Object.keys(tokenData),
        hasAccessToken: !!tokenData.access_token,
        hasAuthorization: !!tokenData.authorization,
        hasRefreshToken: !!tokenData.refresh_token,
        tokenType: tokenData.token_type,
        expiresIn: tokenData.expires_in,
        accessTokenPrefix: tokenData.access_token?.substring(0, 30) + '...',
        authorizationPrefix: tokenData.authorization
          ? tokenData.authorization.substring(0, 30) + '...'
          : '(not present)',
      });

      const tokens: ZidTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type,
        authorization: tokenData.authorization,
      };

      // ═══════════════════════════════════════════════════════════════════════
      // 2. جلب بيانات المتجر
      // ═══════════════════════════════════════════════════════════════════════
      const storeInfo = await this.getStoreInfo(
        tokens.access_token,
        tokens.authorization,
      );
      this.logger.log(`📊 Zid Store: ${storeInfo.id} — ${storeInfo.name}`);

      // ═══════════════════════════════════════════════════════════════════════
      // 3. البحث عن متجر موجود أو إنشاء جديد
      // ═══════════════════════════════════════════════════════════════════════
      let store = await this.storeRepository.findOne({
        where: { zidStoreId: storeInfo.id },
      });

      if (store) {
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

        // ✅ حفظ authorization token (JWT) في settings
        if (tokens.authorization) {
          store.settings = {
            ...(store.settings || {}),
            zidAuthorizationToken: encrypt(tokens.authorization),
          };
        }

        if (!store.tenantId) {
          const tenantId = await this.resolveOrCreateTenant(storeInfo);
          store.tenantId = tenantId;
        }

        this.logger.log(`📦 Updated existing Zid store: ${store.id}`);
      } else {
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
            zidAuthorizationToken: tokens.authorization
              ? encrypt(tokens.authorization)
              : undefined,
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

      // ═══════════════════════════════════════════════════════════════════════
      // 4. إنشاء/تحديث المستخدم + إرسال بيانات الدخول
      // ═══════════════════════════════════════════════════════════════════════
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
      this.logger.error('❌ [V2] Failed exchangeCodeAndAutoRegister', {
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
  // 👤 Store Info — بناءً على وثائق زد الرسمية
  //
  // الطريقة الرسمية (من https://docs.zid.sa/authorization):
  //   Authorization: Bearer {authorization}     ← حقل authorization من token response
  //   X-Manager-Token: {access_token}           ← حقل access_token من token response
  //
  // يجرب عدة endpoints و header combinations حتى ينجح
  // ═══════════════════════════════════════════════════════════════════════════════

  async getStoreInfo(
    accessToken: string,
    authorization?: string,
  ): Promise<ZidStoreInfo> {

    this.logger.log('🔍 [V2] getStoreInfo called', {
      hasAccessToken: !!accessToken,
      hasAuthorization: !!authorization,
    });

    // ✅ بناء كل مجموعات الـ headers الممكنة بالترتيب الصحيح
    const headerSets: Array<{ name: string; headers: Record<string, string> }> = [];

    // الطريقة 1 (الرسمية حسب وثائق زد):
    // Authorization = authorization field, X-Manager-Token = access_token field
    if (authorization) {
      headerSets.push({
        name: 'OFFICIAL: Bearer(authorization) + XMT(access_token)',
        headers: {
          'Authorization': `Bearer ${authorization}`,
          'X-Manager-Token': accessToken,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Accept-Language': 'ar',
          'Role': 'Manager',
        },
      });
    }

    // الطريقة 2 (عكسية — إذا الحقول مقلوبة):
    // Authorization = access_token, X-Manager-Token = authorization
    if (authorization) {
      headerSets.push({
        name: 'REVERSE: Bearer(access_token) + XMT(authorization)',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Manager-Token': authorization,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Accept-Language': 'ar',
          'Role': 'Manager',
        },
      });
    }

    // الطريقة 3: Bearer فقط (بدون X-Manager-Token)
    headerSets.push({
      name: 'BEARER-ONLY: Bearer(access_token)',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Language': 'ar',
      },
    });

    // إذا فيه authorization → جرب Bearer authorization بدون XMT
    if (authorization) {
      headerSets.push({
        name: 'AUTH-BEARER-ONLY: Bearer(authorization)',
        headers: {
          'Authorization': `Bearer ${authorization}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Accept-Language': 'ar',
        },
      });
    }

    // ✅ الـ endpoints المحتملة (من وثائق زد)
    const endpoints = [
      '/managers/account/profile',
      '/managers/store/info',
      '/managers/account',
    ];

    // ✅ جرّب كل endpoint مع كل مجموعة headers
    for (const endpoint of endpoints) {
      for (const headerSet of headerSets) {
        const url = `${this.ZID_API_URL}${endpoint}`;
        try {
          this.logger.log(`🔍 [V2] Trying: ${endpoint} | ${headerSet.name}`);

          const resp = await firstValueFrom(
            this.httpService.get(url, { headers: headerSet.headers }),
          );

          // ✅ نجح!
          this.logger.log(`✅ [V2] SUCCESS: ${endpoint} | ${headerSet.name}`, {
            status: resp.status,
            topKeys: Object.keys(resp.data || {}),
          });

          // استخراج البيانات — زد يرجعها بأشكال مختلفة
          const raw = resp.data;
          const data = raw?.data
            || raw?.store
            || raw?.user?.store
            || raw?.user
            || raw;

          this.logger.log('📊 [V2] Extracted store data:', {
            keys: Object.keys(data || {}),
            id: data?.id,
            store_id: data?.store_id,
            name: data?.name || data?.store_name,
            email: data?.email,
            mobile: data?.mobile,
          });

          // إذا البيانات فيها store متداخل
          const storeData = data?.store || data;

          // ✅ زد يرجع currency و language كـ objects مو strings
          // currency: {"id":4,"name":"ريال سعودي","code":"SAR","symbol":"ر.س",...}
          // language: {"id":2,"name":"عربي","code":"ar","direction":"rtl"}
          const rawCurrency = storeData.currency;
          const rawLanguage = storeData.language;
          const rawLogo = storeData.logo;

          const currencyStr = typeof rawCurrency === 'object' && rawCurrency !== null
            ? (rawCurrency.code || 'SAR')
            : (rawCurrency || 'SAR');

          const languageStr = typeof rawLanguage === 'object' && rawLanguage !== null
            ? (rawLanguage.code || 'ar')
            : (rawLanguage || 'ar');

          // logo قد يكون string أو object
          let logoStr: string | undefined;
          if (typeof rawLogo === 'string' && rawLogo.length > 0) {
            logoStr = rawLogo.substring(0, 490);
          } else if (typeof rawLogo === 'object' && rawLogo !== null) {
            logoStr = (rawLogo.url || rawLogo.original || rawLogo.src || undefined);
          }

          // email قد يكون null في store → نجرب من user level
          // ⚠️ لا نستخدم username كـ email (username = اسم المتجر مو إيميل)
          const rawEmail = storeData.email
            || raw?.user?.email
            || data?.email
            || '';

          // ✅ إذا ما فيه إيميل حقيقي → نولّد إيميل مؤقت
          const storeId = storeData.id || storeData.store_id || storeData.uuid || 'unknown';
          const emailStr = rawEmail && rawEmail.includes('@')
            ? rawEmail
            : `zid_${storeId}@store.rafeq.ai`;

          const mobileStr = storeData.mobile
            || storeData.phone
            || raw?.user?.mobile
            || raw?.user?.phone
            || data?.mobile
            || '';

          // ✅ حماية: mobile قد يكون object (mobile_object) — نستخرج string فقط
          const safeMobile = typeof mobileStr === 'string'
            ? mobileStr.substring(0, 20)
            : (typeof mobileStr === 'object' && mobileStr !== null
              ? String(mobileStr.number || mobileStr.phone || mobileStr.value || '').substring(0, 20)
              : '');

          this.logger.log('📋 [V2] Final mapped values:', {
            id: storeData.id,
            name: storeData.name || storeData.title,
            email: emailStr,
            mobile: safeMobile,
            currency: currencyStr,
            language: languageStr,
            logo: logoStr ? 'present' : 'none',
          });

          return {
            id: String(storeData.id || storeData.store_id || storeData.uuid || ''),
            uuid: String(storeData.uuid || storeData.id || ''),
            name: storeData.name || storeData.store_name || storeData.title || '',
            email: emailStr,
            mobile: safeMobile,
            url: storeData.url || storeData.domain || '',
            logo: logoStr,
            currency: currencyStr,
            language: languageStr,
            created_at: storeData.created_at || new Date().toISOString(),
          };

        } catch (error: any) {
          const status = error?.response?.status || '?';
          const errBody = error?.response?.data;
          const desc = errBody?.message?.description
            || errBody?.message
            || error?.message
            || '';
          this.logger.warn(
            `❌ [V2] ${endpoint} | ${headerSet.name} → ${status}: ${typeof desc === 'object' ? JSON.stringify(desc) : desc}`,
          );
        }
      }
    }

    // كل المحاولات فشلت
    this.logger.error('❌ [V2] ALL getStoreInfo attempts FAILED', {
      endpointCount: endpoints.length,
      headerSetCount: headerSets.length,
      totalAttempts: endpoints.length * headerSets.length,
    });

    throw new BadRequestException(
      'فشل في جلب بيانات المتجر من زد — كل المحاولات فشلت',
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ البحث عن tenant موجود أو إنشاء جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  private async resolveOrCreateTenant(storeInfo: ZidStoreInfo): Promise<string> {
    if (storeInfo.email) {
      const existingUser = await this.autoRegistrationService.findUserByEmail(storeInfo.email);

      if (existingUser?.tenantId) {
        this.logger.log(
          `👤 Existing user found (${existingUser.id}) → reusing tenant ${existingUser.tenantId} for Zid store ${storeInfo.id}`,
        );
        return existingUser.tenantId;
      }
    }

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
