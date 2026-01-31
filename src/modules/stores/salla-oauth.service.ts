/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Service                            ║
 * ║                                                                                ║
 * ║  ✅ يدعم النمط السهل (app.store.authorize webhook)                            ║
 * ║  ✅ يدعم النمط المخصص (OAuth redirect flow)                                   ║
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
import { Store, StorePlatform, StoreStatus } from './entities/store.entity';

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface SallaMerchantInfo {
  id: number;
  username: string;
  name: string;
  email: string;
  mobile: string;
  domain: string;
  avatar: string;
  plan: string;
  created_at: string;
}

// ✅ Interface لـ app.store.authorize webhook
export interface SallaAppAuthorizeData {
  access_token: string;
  expires: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

interface StateData {
  tenantId: string;
  csrfState?: string;
  expiresAt: number;
}

@Injectable()
export class SallaOAuthService {
  private readonly logger = new Logger(SallaOAuthService.name);

  private readonly SALLA_AUTH_URL = 'https://accounts.salla.sa/oauth2/authorize';
  private readonly SALLA_TOKEN_URL = 'https://accounts.salla.sa/oauth2/token';
  private readonly SALLA_API_URL = 'https://api.salla.dev/admin/v2';

  // ⚠️ Use Redis in production
  private readonly stateStorage = new Map<string, StateData>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ النمط السهل - معالجة app.store.authorize webhook
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ معالجة حدث app.store.authorize من سلة
   * هذا هو النمط السهل - التاجر يثبّت من متجر سلة مباشرة
   */
  async handleAppStoreAuthorize(
    merchantId: number,
    data: SallaAppAuthorizeData,
    createdAt: string,
  ): Promise<Store> {
    this.logger.log(`🔐 Processing app.store.authorize for merchant ${merchantId}`);

    const { access_token, refresh_token, expires, scope } = data;

    try {
      // 1. جلب معلومات المتجر من سلة
      const merchantInfo = await this.getMerchantInfo(access_token);
      
      this.logger.log(`📊 Merchant info retrieved`, {
        merchantId,
        storeName: merchantInfo.name,
        email: merchantInfo.email,
      });

      // 2. البحث عن متجر موجود
      let store = await this.storeRepository.findOne({
        where: { sallaMerchantId: merchantId },
      });

      if (store) {
        // ✅ تحديث المتجر الموجود
        this.logger.log(`Updating existing store for merchant ${merchantId}`);
        
        store.accessToken = access_token;
        store.refreshToken = refresh_token;
        store.tokenExpiresAt = new Date(expires * 1000);
        store.status = StoreStatus.ACTIVE;
        store.lastSyncedAt = new Date();
        store.lastTokenRefreshAt = new Date();
        store.consecutiveErrors = 0;
        store.lastError = undefined;
        
        // تحديث معلومات سلة
        store.sallaStoreName = merchantInfo.name;
        store.sallaEmail = merchantInfo.email;
        store.sallaMobile = merchantInfo.mobile;
        store.sallaDomain = merchantInfo.domain;
        store.sallaAvatar = merchantInfo.avatar;
        store.sallaPlan = merchantInfo.plan;
        
      } else {
        // ✅ إنشاء متجر جديد
        this.logger.log(`Creating new store for merchant ${merchantId}`);
        
        store = this.storeRepository.create({
          // ⚠️ tenantId مؤقتاً - سيحتاج ربط لاحقاً عبر Dashboard
          // يمكن للتاجر ربطه من صفحة المتاجر
          name: merchantInfo.name,
          platform: StorePlatform.SALLA,
          status: StoreStatus.ACTIVE,
          
          // Tokens
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenExpiresAt: new Date(expires * 1000),
          
          // Salla info
          sallaMerchantId: merchantId,
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
          
          // Settings
          currency: 'SAR',
          subscribedEvents: scope.split(' '),
          lastSyncedAt: new Date(),
          lastTokenRefreshAt: new Date(),
          settings: {
            connectedVia: 'easy_mode',
            connectedAt: createdAt,
          },
        });
      }

      const savedStore = await this.storeRepository.save(store);

      this.logger.log(`✅ Store saved successfully`, {
        storeId: savedStore.id,
        merchantId,
        status: savedStore.status,
      });

      return savedStore;

    } catch (error) {
      this.logger.error(`❌ Failed to handle app.store.authorize`, {
        merchantId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * ✅ معالجة حدث app.uninstalled من سلة
   */
  async handleAppUninstalled(merchantId: number): Promise<void> {
    this.logger.log(`🗑️ Processing app.uninstalled for merchant ${merchantId}`);

    try {
      await this.storeRepository.update(
        { sallaMerchantId: merchantId },
        {
          status: StoreStatus.UNINSTALLED,
          accessToken: undefined,
          refreshToken: undefined,
        },
      );

      this.logger.log(`✅ Store marked as uninstalled for merchant ${merchantId}`);

    } catch (error) {
      this.logger.error(`❌ Failed to handle app.uninstalled`, {
        merchantId,
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  /**
   * ✅ ربط متجر بـ Tenant (من Dashboard)
   */
  async linkStoreToTenant(merchantId: number, tenantId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { sallaMerchantId: merchantId },
    });

    if (!store) {
      throw new BadRequestException(`Store not found for merchant ${merchantId}`);
    }

    if (store.tenantId && store.tenantId !== tenantId) {
      throw new BadRequestException('Store already linked to another tenant');
    }

    store.tenantId = tenantId;
    return this.storeRepository.save(store);
  }

  /**
   * ✅ الحصول على متاجر غير مربوطة (للعرض في Dashboard)
   */
  async getUnlinkedStores(): Promise<Store[]> {
    return this.storeRepository.find({
      where: { tenantId: undefined as any, status: StoreStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 النمط المخصص - OAuth redirect flow
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * توليد رابط OAuth
   */
  generateAuthorizationUrl(tenantId: string, csrfState?: string): string {
    const state = this.generateState(tenantId, csrfState);

    const clientId = this.configService.get<string>('SALLA_CLIENT_ID');
    const redirectUri = this.configService.get<string>('SALLA_REDIRECT_URI');

    const scopes = ['offline_access'].join(' ');

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri!,
      response_type: 'code',
      scope: scopes,
      state,
    });

    const authUrl = `${this.SALLA_AUTH_URL}?${params.toString()}`;

    this.logger.log(`Generated OAuth URL for tenant: ${tenantId}`);

    return authUrl;
  }

  /**
   * استبدال الكود بـ tokens
   */
  async exchangeCodeForTokens(
    code: string,
    state: string,
  ): Promise<{ tokens: SallaTokenResponse; tenantId: string; csrfState?: string }> {
    const stateData = this.verifyState(state);

    if (!stateData) {
      throw new UnauthorizedException('Invalid or expired state');
    }

    const { tenantId, csrfState } = stateData;

    try {
      const clientId = this.configService.get<string>('SALLA_CLIENT_ID');
      const clientSecret = this.configService.get<string>('SALLA_CLIENT_SECRET');
      const redirectUri = this.configService.get<string>('SALLA_REDIRECT_URI');

      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          this.SALLA_TOKEN_URL,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: clientId!,
            client_secret: clientSecret!,
            redirect_uri: redirectUri!,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      this.logger.log(`Successfully exchanged code for tokens, tenant: ${tenantId}`);

      return {
        tokens: response.data,
        tenantId,
        csrfState,
      };

    } catch (error: any) {
      this.logger.error('Failed to exchange code for tokens', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Management
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<SallaTokenResponse> {
    try {
      const clientId = this.configService.get<string>('SALLA_CLIENT_ID');
      const clientSecret = this.configService.get<string>('SALLA_CLIENT_SECRET');

      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          this.SALLA_TOKEN_URL,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId!,
            client_secret: clientSecret!,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      this.logger.log('Successfully refreshed access token');

      return response.data;

    } catch (error: any) {
      this.logger.error('Failed to refresh access token', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new UnauthorizedException('Failed to refresh access token');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Salla API
  // ═══════════════════════════════════════════════════════════════════════════════

  async getMerchantInfo(accessToken: string): Promise<SallaMerchantInfo> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.SALLA_API_URL}/store/info`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      return response.data.data;

    } catch (error: any) {
      this.logger.error('Failed to get merchant info', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to get merchant information');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛠️ Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateState(tenantId: string, csrfState?: string): string {
    const state = crypto.randomBytes(32).toString('hex');

    this.stateStorage.set(state, {
      tenantId,
      csrfState,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    this.cleanupExpiredStates();

    return state;
  }

  private verifyState(state: string): StateData | null {
    const stateData = this.stateStorage.get(state);

    if (!stateData) {
      return null;
    }

    this.stateStorage.delete(state);

    if (Date.now() > stateData.expiresAt) {
      return null;
    }

    return stateData;
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
