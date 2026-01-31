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
// Types
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
   * @param tenantId معرّف المستأجر (مطلوب)
   * @param customState state إضافي من المستخدم (اختياري)
   * @returns رابط OAuth الكامل
   */
  generateAuthorizationUrl(tenantId: string, customState?: string): string {
    // تشفير tenantId مع customState في الـ state parameter
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
   * ✅ استبدال الـ code بـ tokens وإنشاء/تحديث المتجر
   * @param code الـ authorization code من سلة
   * @param state الـ state الذي يحتوي tenantId
   * @returns نتيجة OAuth مع tokens و tenantId
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<OAuthResult> {
    this.logger.log('Exchanging code for tokens');

    // استخراج tenantId من state
    const tenantId = this.extractTenantIdFromState(state);
    
    if (!tenantId) {
      throw new BadRequestException('Invalid state: missing tenantId');
    }

    try {
      // طلب الـ tokens من سلة
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
      
      // جلب معلومات التاجر
      const merchantInfo = await this.fetchMerchantInfo(tokens.access_token);
      
      // إنشاء أو تحديث المتجر
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

  /**
   * ✅ جلب معلومات التاجر من سلة
   */
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

  /**
   * ✅ إنشاء أو تحديث المتجر
   */
  private async createOrUpdateStore(
    tenantId: string,
    tokens: SallaTokenResponse,
    merchantInfo: SallaMerchantInfo,
  ): Promise<Store> {
    // البحث عن متجر موجود
    let store = await this.storeRepository.findOne({
      where: { merchantId: merchantInfo.id },
    });

    if (store) {
      // تحديث المتجر الموجود
      store.tenantId = tenantId;
      store.accessToken = tokens.access_token;
      store.refreshToken = tokens.refresh_token;
      store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
      store.lastTokenRefreshAt = new Date();
      store.isActive = true;
      
      this.logger.log(`Updated existing store: ${store.id}`);
    } else {
      // إنشاء متجر جديد
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

  /**
   * ✅ حساب وقت انتهاء التوكن
   */
  calculateTokenExpiry(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Refresh
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ تجديد الـ access token
   */
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

  /**
   * ✅ البحث عن متجر بـ merchantId
   */
  async findByMerchantId(merchantId: number): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { merchantId },
    });
  }

  /**
   * ✅ الحصول على المتاجر غير المرتبطة
   */
  async getUnlinkedStores(): Promise<Store[]> {
    return this.storeRepository.find({
      where: { tenantId: undefined as any },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Easy Mode (App Store)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ معالجة تفويض App Store (Easy Mode)
   */
  async handleAppStoreAuthorize(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    merchantId: number,
  ): Promise<Store> {
    this.logger.log(`App Store authorize for merchant ${merchantId}`);

    const merchantInfo = await this.fetchMerchantInfo(accessToken);

    const tokens: SallaTokenResponse = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      token_type: 'Bearer',
    };

    // في Easy Mode، لا يوجد tenantId بعد - سيتم ربطه لاحقاً
    let store = await this.storeRepository.findOne({
      where: { merchantId },
    });

    if (store) {
      store.accessToken = accessToken;
      store.refreshToken = refreshToken;
      store.tokenExpiresAt = this.calculateTokenExpiry(expiresIn);
      store.isActive = true;
    } else {
      store = this.storeRepository.create({
        merchantId,
        name: merchantInfo.name || `متجر سلة`,
        domain: merchantInfo.domain,
        email: merchantInfo.email,
        phone: merchantInfo.mobile,
        plan: merchantInfo.plan,
        accessToken,
        refreshToken,
        tokenExpiresAt: this.calculateTokenExpiry(expiresIn),
        isActive: true,
        connectedAt: new Date(),
      });
    }

    return this.storeRepository.save(store);
  }

  /**
   * ✅ معالجة إلغاء تثبيت التطبيق
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
