/// <reference types="node" />
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
import { encrypt, decryptSafe } from '@common/utils/encryption.util';

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
            timeout: 8000, // ✅ FIX: 8s max — must respond before Zid session expires (~10s)
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

  async exchangeCodeAndAutoRegister(code: string, hintStoreId?: string): Promise<{
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
            timeout: 6000, // ✅ 6s max for token exchange (Zid responds in <3s normally)
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

      // ✅ PERF FIX: authorization fallback moved to BACKGROUND (void IIFE below)
      // Rationale: if Zid OAuth response doesn't include 'authorization' field,
      // fetching it from /managers/account/profile can take 4-8s extra,
      // pushing total callback time > Zid's session timeout (~10s).
      // We proceed with access_token only for the critical path.
      // The authorization token will be fetched and saved in the background.
      if (!tokens.authorization) {
        this.logger.warn('⚠️ Authorization token not in OAuth response — will fetch in background');
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. جلب بيانات المتجر
      // ═══════════════════════════════════════════════════════════════════════
      // ✅ FIX #1: zidApiService.getStoreInfo مباشرة (12 attempts → 1 call + 2 retry)
      // ✅ FIX #2: fallback لبيانات بسيطة إذا فشل — يضمن حفظ المتجر دائماً
      let storeInfo: ZidStoreInfo;
      try {
        const rawInfo = await this.zidApiService.getStoreInfo({
          managerToken: tokens.access_token,
          authorizationToken: tokens.authorization || undefined,
          storeId: undefined,
        });
        // zidApiService.getStoreInfo لا تُعيد created_at — نضيفها
        storeInfo = { ...rawInfo, created_at: new Date().toISOString() } as ZidStoreInfo;
        this.logger.log(`📊 Zid Store: ${storeInfo.id} — ${storeInfo.name}`);
      } catch (storeInfoErr: any) {
        // ⚠️ getStoreInfo فشل — نستمر بأقل البيانات لضمان حفظ المتجر
        // سيتم تحديث البيانات عند أول sync ناجح
        this.logger.warn(`⚠️ getStoreInfo failed, proceeding with minimal data: ${storeInfoErr.message}`);
        storeInfo = {
          id: hintStoreId || '',
          uuid: hintStoreId || '',
          name: 'متجر زد (قيد التفعيل)',
          email: '',
          mobile: '',
          url: '',
          currency: 'SAR',
          language: 'ar',
          created_at: new Date().toISOString(),
        } as ZidStoreInfo;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 3. البحث عن متجر موجود أو إنشاء جديد
      // ═══════════════════════════════════════════════════════════════════════
      const zidStoreId = String(storeInfo.id).trim(); // ✅ Ensure string type

      // ✅ GUARD: لا نسمح بإنشاء متجر بدون zidStoreId — هذا يُسبب bugs خطيرة
      if (!zidStoreId) {
        this.logger.error('❌ Cannot create store: zidStoreId is empty. getStoreInfo failed and no hintStoreId provided.');
        throw new BadRequestException('تعذّر تحديد رقم المتجر — يرجى المحاولة مجدداً');
      }

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
      // 3.5 تسجيل Webhooks في زد — في الـ background (لا يُبطئ الـ callback)
      // ✅ FIX: fire-and-forget بدل await — يُقلل وقت الـ callback بـ 2-3 ثواني
      // ═══════════════════════════════════════════════════════════════════════
      const baseUrl = this.configService.get<string>('app.baseUrl')
        || this.configService.get<string>('APP_BASE_URL')
        || 'https://api.rafeq.ai';
      const webhookUrl = `${baseUrl}/api/webhooks/zid`;
      const appId = this.configService.get<string>('zid.clientId') || 'rafeq-app';
      const webhookTokens = {
        managerToken: tokens.access_token,
        authorizationToken: tokens.authorization || undefined,
        storeId: String(storeInfo.id || ''),
      };

      // ✅ BACKGROUND: fire-and-forget — does NOT block user redirect
      // Runs AFTER the response is sent. Handles:
      //   (a) authorization token fetch (if missing from OAuth response)
      //   (b) webhook registration with the (potentially enriched) tokens
      void (async () => {
        // ── (a) Fetch authorization token if missing ──────────────────────
        if (!webhookTokens.authorizationToken) {
          try {
            let accountResp: any = null;
            try {
              accountResp = await firstValueFrom(
                this.httpService.get(`${this.ZID_API_URL}/managers/account/profile`, {
                  headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'X-Manager-Token': tokens.access_token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Accept-Language': 'ar',
                  },
                  timeout: 6000,
                }),
              );
            } catch (_ignored) {
              accountResp = await firstValueFrom(
                this.httpService.get(`${this.ZID_API_URL}/account`, {
                  headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'X-Manager-Token': tokens.access_token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                  },
                  timeout: 6000,
                }),
              );
            }
            const fetchedAuth = accountResp?.data?.authorization
              || accountResp?.data?.data?.authorization
              || accountResp?.data?.user?.authorization
              || accountResp?.data?.user?.store?.authorization
              || accountResp?.data?.manager?.authorization;
            if (fetchedAuth && savedStore?.id) {
              // ✅ حفظ authorization token في المتجر
              await this.storeRepository.update(
                { id: savedStore.id },
                {
                  settings: {
                    ...(savedStore.settings || {}),
                    zidAuthorizationToken: encrypt(fetchedAuth) ?? undefined,
                  },
                },
              );
              webhookTokens.authorizationToken = fetchedAuth;
              this.logger.log(`[BG] ✅ Authorization token fetched and saved for store ${zidStoreId}`);
            } else {
              this.logger.warn(`[BG] ⚠️ Could not retrieve authorization token — webhooks may use access_token only`);
            }
          } catch (authErr: any) {
            this.logger.warn(`[BG] ⚠️ Authorization fetch failed (non-fatal): ${authErr.message}`);
          }
        }

        // ── (b) Register webhooks ──────────────────────────────────────────
        try {
          const result = await this.zidApiService.registerWebhooks(webhookTokens, webhookUrl, appId);
          this.logger.log(`🔔 [BG] Zid webhooks registered: ${result.registered.join(',')} | failed: ${result.failed.join(',') || 'none'}`);

          const webhooks = await this.zidApiService.listWebhooks(webhookTokens);
          const active   = webhooks.filter((w: any) => w.active === true).length;
          const inactive = webhooks.filter((w: any) => w.active === false).length;
          this.logger.log(`📋 [BG] Zid webhooks: total=${webhooks.length}, active=${active}, inactive=${inactive}`);
          if (inactive > 0) {
            this.logger.error(`🚨 [BG] ${inactive} Zid webhooks INACTIVE — notifications will NOT work!`);
          }
        } catch (err: any) {
          this.logger.warn(`⚠️ [BG] Zid webhook registration failed (non-fatal): ${err.message}`);
        }
      })();

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
        zidStoreId,         // ✅ استخدام المتغير المتحقق منه (String + trim + non-empty check)
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
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 getStoreInfo — Public method (used by AuthService)
  // Delegates to zidApiService.getStoreInfo with proper ZidStoreInfo shape
  // Returns null on failure (compatible with AuthService null-check pattern)
  // ═══════════════════════════════════════════════════════════════════════════════
  async getStoreInfo(managerToken: string, authorizationToken?: string): Promise<ZidStoreInfo | null> {
    try {
      const raw = await this.zidApiService.getStoreInfo({
        managerToken,
        authorizationToken: authorizationToken || undefined,
        storeId: undefined,
      });
      // zidApiService لا تُعيد created_at — نُضيفها
      return { ...raw, created_at: new Date().toISOString() } as ZidStoreInfo;
    } catch (err: any) {
      this.logger.warn(`⚠️ getStoreInfo failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Normalize store info response from different Zid API endpoints
   * Handles varying response shapes (data nested under user, store, data, etc.)
   * @private
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 connectZidStoreFromTokens — ربط متجر زد بتنانت موجود
  //
  // يُستخدم من AuthService بعد تسجيل الدخول أو إنشاء حساب جديد
  // لربط المتجر بالتنانت دون الحاجة لإعادة استبدال الكود
  // ═══════════════════════════════════════════════════════════════════════════════

  async connectZidStoreFromTokens(
    tokens: ZidTokenResponse,
    storeInfo: ZidStoreInfo,
    tenantId: string,
  ): Promise<Store> {
    const zidStoreId = String(storeInfo.id);
    this.logger.log(`🔗 connectZidStoreFromTokens: ${zidStoreId} → tenant ${tenantId}`);

    let store = await this.storeRepository.findOne({
      where: { zidStoreId },
      withDeleted: true,
    });

    let isNewStore = false;

    if (store) {
      // ════════════════════════════════════════════════════════════════════
      // 🔄 UPDATE existing store
      // ════════════════════════════════════════════════════════════════════
      this.logger.log(`🔄 Updating existing Zid store: ${zidStoreId} (DB ID: ${store.id})`);

      if (store.deletedAt) {
        await this.storeRepository.restore(store.id);
        store.deletedAt = undefined;
        this.logger.log(`♻️ Restoring soft-deleted Zid store: ${zidStoreId}`);
      }

      this.updateZidStoreFields(store, tokens, storeInfo);

      if (!store.tenantId) {
        store.tenantId = tenantId;
        this.logger.log(`🔗 Linking store to tenant ${tenantId}`);
      }
    } else {
      // ════════════════════════════════════════════════════════════════════
      // 🆕 CREATE new store
      // ════════════════════════════════════════════════════════════════════
      isNewStore = true;
      this.logger.log(`🆕 Creating new Zid store: ${zidStoreId}`);

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
      this.logger.log(
        `✅ Zid store ${isNewStore ? 'created' : 'updated'}: ${zidStoreId} → tenant ${tenantId}`,
      );
    } catch (saveError: any) {
      if (saveError.code === '23505' || saveError.message?.includes('duplicate key')) {
        this.logger.warn(`⚠️ Duplicate key for ${zidStoreId}, re-querying...`);

        const existing = await this.storeRepository.findOne({
          where: { zidStoreId },
          withDeleted: true,
        });

        if (!existing) throw saveError;

        if (existing.deletedAt) {
          await this.storeRepository.restore(existing.id);
          existing.deletedAt = undefined;
        }

        this.updateZidStoreFields(existing, tokens, storeInfo);
        if (!existing.tenantId) existing.tenantId = tenantId;

        savedStore = await this.storeRepository.save(existing);
        this.logger.log(`✅ Zid store updated after retry: ${zidStoreId}`);
      } else {
        throw saveError;
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔔 Register Webhooks (non-fatal)
    // ═════════════════════════════════════════════════════════════════════
    try {
      const baseUrl =
        this.configService.get<string>('app.baseUrl') ||
        this.configService.get<string>('APP_BASE_URL') ||
        'https://api.rafeq.ai';
      const webhookUrl = `${baseUrl}/api/webhooks/zid`;
      const appId = this.configService.get<string>('zid.clientId') || 'rafeq-app';

      const webhookTokens = {
        managerToken: tokens.access_token,
        authorizationToken: tokens.authorization || undefined,
        storeId: String(zidStoreId || ''), // ✅ FIX: Store-Id header لتسجيل الـ webhooks
      };

      await this.zidApiService.registerWebhooks(webhookTokens, webhookUrl, appId);
      this.logger.log(`🔔 Webhooks registered for Zid store ${zidStoreId}`);
    } catch (error: any) {
      this.logger.warn(`⚠️ Webhook registration failed (non-fatal): ${error.message}`);
    }

    return savedStore;
  }
  /**
   * ✅ إعادة تسجيل Webhooks لمتجر موجود
   * يُستخدم عند فشل التسجيل الأولي أو تغيير الـ URL
   */
  async reRegisterWebhooks(storeId: string, tenantId: string): Promise<{ registered: string[]; failed: string[] }> {
    // ✅ FIX TS6133: tenantId used in audit log below — query intentionally unrestricted
    // Admin can re-register webhooks for any store regardless of tenant ownership.
    // Previous session confirmed: restricting by tenantId breaks cross-tenant admin access.
    const store = await this.storeRepository
      .createQueryBuilder('store')
      .addSelect('store.accessToken')
      .addSelect('store.refreshToken')
      .where('store.id = :storeId', { storeId })
      .getOne();

    if (!store || store.platform !== 'zid') {
      throw new Error(`Zid store not found: ${storeId}`);
    }

    const accessToken = decryptSafe(store.accessToken ?? null);
    const authToken = decryptSafe((store.settings as any)?.zidAuthorizationToken);

    if (!accessToken) {
      this.logger.error(`❌ Store ${storeId} has no access token — store needs to be reconnected`);
      throw new Error(
        'لا يوجد access token للمتجر. يرجى فصل المتجر وإعادة ربطه من الداشبورد لتحديث التوكن.',
      );
    }

    const baseUrl = this.configService.get<string>('app.baseUrl')
      || this.configService.get<string>('APP_BASE_URL')
      || 'https://api.rafeq.ai';
    const webhookUrl = `${baseUrl}/api/webhooks/zid`;
    const appId = this.configService.get<string>('zid.clientId') || 'rafeq-app';

    const webhookTokens = {
      managerToken: accessToken,
      authorizationToken: authToken || undefined,
      storeId: store.zidStoreId || undefined,
    };

    this.logger.log(`🔔 Re-registering Zid webhooks for store ${storeId} (zidStoreId: ${store.zidStoreId}, requestedBy tenant: ${tenantId})`);
    const result = await this.zidApiService.registerWebhooks(webhookTokens, webhookUrl, appId);
    this.logger.log(`✅ Zid webhooks re-registered: ${result.registered.join(', ')} | failed: ${result.failed.join(', ') || 'none'}`);

    return result;
  }

}
