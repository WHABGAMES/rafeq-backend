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
import { ZidApiService } from './zid-api.service';

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
    private readonly zidApiService: ZidApiService,
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

      // ✅ FIX: If authorization token is missing from OAuth response, try to retrieve it
      // from the Zid account endpoint. This handles the reactivation scenario where Zid
      // may not include the authorization field in the token response.
      if (!tokens.authorization) {
        this.logger.warn('⚠️ Authorization token not in OAuth response - attempting to retrieve from Zid account');
        try {
          const accountResp = await firstValueFrom(
            this.httpService.get(`${this.ZID_API_URL}/account`, {
              headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
              },
            }),
          );
          const authToken = accountResp.data?.authorization
            || accountResp.data?.data?.authorization
            || accountResp.data?.user?.authorization;
          if (authToken) {
            tokens.authorization = authToken;
            this.logger.log('✅ Retrieved authorization token from Zid account endpoint');
          } else {
            this.logger.warn('⚠️ Authorization token not available from Zid account endpoint - will proceed with access token only');
          }
        } catch (error: any) {
          this.logger.warn('⚠️ Could not fetch authorization from Zid account endpoint', {
            error: error?.response?.data || error.message,
          });
        }
      }

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
      const zidStoreId = String(storeInfo.id); // ✅ Ensure string type
      let store = await this.storeRepository.findOne({
        where: { zidStoreId },
        withDeleted: true,  // ✅ Include soft-deleted stores to handle re-installation after deletion
      });

      let isNewStore = false;

      if (store) {
        // ════════════════════════════════════════════════════════════════════
        // 🔄 UPDATE existing store (re-installation scenario)
        // ════════════════════════════════════════════════════════════════════
        this.logger.log(`🔄 Updating existing Zid store: ${zidStoreId} (DB ID: ${store.id})`);

        // ♻️ Restore soft-deleted store if merchant is re-installing
        if (store.deletedAt) {
          await this.storeRepository.restore(store.id);
          store.deletedAt = undefined;
          this.logger.log(`♻️ Restoring soft-deleted Zid store: ${zidStoreId}`);
        }

        this.updateZidStoreFields(store, tokens, storeInfo);

        if (!store.tenantId) {
          const tenantId = await this.resolveOrCreateTenant(storeInfo);
          store.tenantId = tenantId;
          this.logger.log(`🔗 Linking store to tenant ${tenantId}`);
        }
      } else {
        // ════════════════════════════════════════════════════════════════════
        // 🆕 CREATE new store (first-time installation)
        // ════════════════════════════════════════════════════════════════════
        isNewStore = true;
        this.logger.log(`🆕 Creating new Zid store: ${zidStoreId}`);

        const tenantId = await this.resolveOrCreateTenant(storeInfo);

        store = this.storeRepository.create({
          tenantId,
          name: storeInfo.name || `متجر زد ${zidStoreId}`,
          platform: StorePlatform.ZID,
          status: StoreStatus.ACTIVE,
          zidStoreId,
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
          lastTokenRefreshAt: new Date(),
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
      }

      // ═════════════════════════════════════════════════════════════════════
      // 💾 Save store (with duplicate key handling)
      // ═════════════════════════════════════════════════════════════════════
      let savedStore: Store;
      try {
        savedStore = await this.storeRepository.save(store);
        
        if (isNewStore) {
          this.logger.log(`✅ Zid store created: ${zidStoreId} → tenant ${store.tenantId}`);
        } else {
          this.logger.log(`✅ Zid store updated: ${zidStoreId} → tenant ${store.tenantId}`);
        }
      } catch (saveError: any) {
        // Handle duplicate key constraint violation (race condition)
        if (saveError.code === '23505' || saveError.message?.includes('duplicate key')) {
          this.logger.warn(`⚠️ Duplicate key detected for ${zidStoreId}, re-querying and updating...`);
          
          // Re-query the existing store (including soft-deleted)
          const existingStore = await this.storeRepository.findOne({
            where: { zidStoreId },
            withDeleted: true,  // ✅ Must include soft-deleted to resolve constraint violation
          });
          
          if (!existingStore) {
            // This shouldn't happen, but handle it anyway
            this.logger.error(`❌ Duplicate key but store not found: ${zidStoreId}`);
            throw new Error('Database inconsistency detected');
          }
          
          // ♻️ Restore soft-deleted store if needed
          if (existingStore.deletedAt) {
            await this.storeRepository.restore(existingStore.id);
            existingStore.deletedAt = undefined;
          }
          
          // Update the existing store using shared logic
          this.updateZidStoreFields(existingStore, tokens, storeInfo);
          
          if (!existingStore.tenantId && store.tenantId) {
            existingStore.tenantId = store.tenantId;
            this.logger.log(`🔗 Linking store to tenant ${store.tenantId}`);
          }
          
          savedStore = await this.storeRepository.save(existingStore);
          this.logger.log(`✅ Zid store updated after retry: ${zidStoreId} → tenant ${savedStore.tenantId}`);
        } else {
          throw saveError;
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3.5 تسجيل Webhooks في زد (مطلوب عبر API)
      // ═══════════════════════════════════════════════════════════════════════
      try {
        const baseUrl = this.configService.get<string>('app.baseUrl')
          || this.configService.get<string>('APP_BASE_URL')
          || 'https://api.rafeq.ai';
        const webhookUrl = `${baseUrl}/api/webhooks/zid`;
        const appId = this.configService.get<string>('zid.clientId') || 'rafeq-app';

        const webhookTokens = {
          managerToken: tokens.access_token,
          authorizationToken: tokens.authorization || undefined,
        };

        const result = await this.zidApiService.registerWebhooks(webhookTokens, webhookUrl, appId);
        this.logger.log(`🔔 Zid webhooks: registered=${result.registered.join(',')} | failed=${result.failed.join(',') || 'none'}`);

        // ✅ v3: تحقق من حالة الـ webhooks بعد التسجيل
        try {
          const webhooks = await this.zidApiService.listWebhooks(webhookTokens);
          const activeCount = webhooks.filter((w: any) => w.active === true).length;
          const inactiveCount = webhooks.filter((w: any) => w.active === false).length;
          this.logger.log(`📋 Zid webhooks status: total=${webhooks.length}, active=${activeCount}, inactive=${inactiveCount}`);
          if (inactiveCount > 0) {
            this.logger.error(`🚨 WARNING: ${inactiveCount} Zid webhooks are INACTIVE — notifications will NOT work!`);
          }
        } catch (listErr: any) {
          this.logger.warn(`⚠️ Could not verify Zid webhook status: ${listErr.message}`);
        }
      } catch (error: any) {
        this.logger.warn(`⚠️ Zid webhook registration failed (non-fatal): ${error.message}`);
      }

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

  /**
   * Helper method to update an existing Zid store with new tokens and info
   * Used both in normal update path and duplicate key retry path
   */
  private updateZidStoreFields(
    store: Store,
    tokens: ZidTokenResponse,
    storeInfo: ZidStoreInfo,
  ): void {
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
      // New authorization token provided — update it
      store.settings = {
        ...(store.settings || {}),
        zidAuthorizationToken: encrypt(tokens.authorization),
      };
      this.logger.log(`✅ Authorization token updated for store ${store.zidStoreId}`);
    } else {
      // ✅ FIX: Clear old (potentially invalid) authorization token when Zid does not return one
      // This prevents using a revoked token from a previous connection after reactivation
      const { zidAuthorizationToken: _removed, ...otherSettings } = (store.settings as any) || {};
      store.settings = otherSettings;
      this.logger.warn(`⚠️ No authorization token from Zid - cleared old token for store ${store.zidStoreId}`, {
        storeName: store.zidStoreName,
      });
    }
  }

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
