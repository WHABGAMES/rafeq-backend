/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Service                            ║
 * ║                                                                                ║
 * ║  ✅ OAuth 2.0 Flow مع سلة                                                      ║
 * ║  ✅ يدعم Easy Mode و Standard OAuth                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';

import { Store } from './entities/store.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Exported Types - تُستخدم في ملفات أخرى
// ═══════════════════════════════════════════════════════════════════════════════

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface SallaMerchantInfo {
  id: number;
  name: string;
  email: string;
  mobile: string;
  domain: string;
  plan: string;
}

export interface OAuthResult {
  tokens: SallaTokenResponse;
  tenantId: string;
  merchantId: number;
}

/**
 * ✅ بيانات app.store.authorize من webhook سلة
 * تُستخدم في salla-webhooks.controller.ts
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
  ) {
    this.clientId = this.configService.getOrThrow<string>('SALLA_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('SALLA_CLIENT_SECRET');
    this.redirectUri = this.configService.getOrThrow<string>('SALLA_REDIRECT_URI');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 OAuth URL Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ توليد رابط OAuth لسلة
   */
  generateAuthorizationUrl(tenantId: string, customState?: string): string {
    const stateData = {
      tenantId,
      custom: customState || '',
      timestamp: Date.now(),
    };
    
    const state = Buffer.from(JSON.stringify(stateData)).toString('base64url');

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'offline_access',
      state,
    });

    const url = `${this.sallaAuthUrl}?${params.toString()}`;
    
    this.logger.log(`Generated OAuth URL for tenant ${tenantId}`);
    
    return url;
  }

  /**
   * ✅ استخراج tenantId من state
   */
  extractTenantIdFromState(state: string): string | null {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf-8');
      const stateData = JSON.parse(decoded);
      return stateData.tenantId || null;
    } catch (error) {
      this.logger.error('Failed to decode state', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Exchange
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ استبدال الـ code بـ tokens
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<OAuthResult> {
    this.logger.log('Exchanging code for tokens');

    const tenantId = this.extractTenantIdFromState(state);
    
    if (!tenantId) {
      throw new BadRequestException('Invalid state: missing tenantId');
    }

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
      
      await this.createOrUpdateStore(tenantId, tokens, merchantInfo);

      this.logger.log(`OAuth completed for tenant ${tenantId}, merchant ${merchantInfo.id}`);

      return {
        tokens,
        tenantId,
        merchantId: merchantInfo.id,
      };
    } catch (error: any) {
      this.logger.error('Failed to exchange code for tokens', {
        error: error.response?.data || error.message,
      });
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Merchant Info
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

      return response.data.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch merchant info', error.message);
      throw new BadRequestException('Failed to fetch merchant information');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 Store Management
  // ═══════════════════════════════════════════════════════════════════════════════

  private async createOrUpdateStore(
    tenantId: string,
    tokens: SallaTokenResponse,
    merchantInfo: SallaMerchantInfo,
  ): Promise<Store> {
    let store = await this.storeRepository.findOne({
      where: { merchantId: merchantInfo.id },
    });

    if (store) {
      store.tenantId = tenantId;
      store.accessToken = tokens.access_token;
      store.refreshToken = tokens.refresh_token;
      store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
      store.lastTokenRefreshAt = new Date();
      store.isActive = true;
      
      this.logger.log(`Updated existing store: ${store.id}`);
    } else {
      store = this.storeRepository.create({
        tenantId,
        merchantId: merchantInfo.id,
        name: merchantInfo.name || `متجر سلة`,
        domain: merchantInfo.domain,
        email: merchantInfo.email,
        phone: merchantInfo.mobile,
        plan: merchantInfo.plan,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: this.calculateTokenExpiry(tokens.expires_in),
        isActive: true,
        connectedAt: new Date(),
      });
      
      this.logger.log(`Created new store for merchant ${merchantInfo.id}`);
    }

    return this.storeRepository.save(store);
  }

  calculateTokenExpiry(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Refresh
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<SallaTokenResponse> {
    this.logger.log('Refreshing access token');

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

      this.logger.log('Token refreshed successfully');
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to refresh token', error.message);
      throw new BadRequestException('Failed to refresh access token');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 Store Lookup
  // ═══════════════════════════════════════════════════════════════════════════════

  async findByMerchantId(merchantId: number): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { merchantId },
    });
  }

  async getUnlinkedStores(): Promise<Store[]> {
    return this.storeRepository.find({
      where: { tenantId: undefined as any },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Easy Mode - Webhook Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ معالجة app.store.authorize من webhook سلة
   * يُستدعى من salla-webhooks.controller.ts
   * 
   * @param merchantId معرّف التاجر
   * @param data بيانات التفويض (SallaAppAuthorizeData)
   * @param createdAt وقت الـ webhook
   */
  async handleAppStoreAuthorize(
    merchantId: number,
    data: SallaAppAuthorizeData,
    createdAt: string,
  ): Promise<Store> {
    this.logger.log(`App Store authorize for merchant ${merchantId}`, { createdAt });

    const merchantInfo = await this.fetchMerchantInfo(data.access_token);

    let store = await this.storeRepository.findOne({
      where: { merchantId },
    });

    const expiresIn = data.expires || 3600;

    if (store) {
      store.accessToken = data.access_token;
      store.refreshToken = data.refresh_token;
      store.tokenExpiresAt = this.calculateTokenExpiry(expiresIn);
      store.lastTokenRefreshAt = new Date();
      store.isActive = true;
      store.name = merchantInfo.name || store.name;
      store.domain = merchantInfo.domain || store.domain;
      store.email = merchantInfo.email || store.email;
      store.phone = merchantInfo.mobile || store.phone;
      
      this.logger.log(`Updated store for merchant ${merchantId}`);
    } else {
      store = this.storeRepository.create({
        merchantId,
        name: merchantInfo.name || `متجر سلة`,
        domain: merchantInfo.domain,
        email: merchantInfo.email,
        phone: merchantInfo.mobile,
        plan: merchantInfo.plan,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenExpiresAt: this.calculateTokenExpiry(expiresIn),
        isActive: true,
        connectedAt: new Date(),
      });
      
      this.logger.log(`Created new store for merchant ${merchantId} (Easy Mode)`);
    }

    return this.storeRepository.save(store);
  }

  /**
   * ✅ معالجة app.uninstalled
   */
  async handleAppUninstalled(merchantId: number): Promise<void> {
    this.logger.log(`App uninstalled for merchant ${merchantId}`);

    const store = await this.storeRepository.findOne({
      where: { merchantId },
    });

    if (store) {
      store.isActive = false;
      store.disconnectedAt = new Date();
      store.accessToken = undefined as any;
      store.refreshToken = undefined as any;
      
      await this.storeRepository.save(store);
      this.logger.log(`Deactivated store for merchant ${merchantId}`);
    }
  }

  /**
   * ✅ ربط متجر بـ tenant
   */
  async linkStoreToTenant(storeId: string, tenantId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });

    if (!store) {
      throw new BadRequestException('Store not found');
    }

    store.tenantId = tenantId;
    
    this.logger.log(`Linked store ${storeId} to tenant ${tenantId}`);
    
    return this.storeRepository.save(store);
  }
}
