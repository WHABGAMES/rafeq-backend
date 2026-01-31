/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Salla OAuth Service                        ║
 * ║                                                                                ║
 * ║  ✅ يدعم النمط السهل (Easy Mode) عبر app.store.authorize webhook              ║
 * ║  ✅ يدعم OAuth Redirect Flow                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { Store, StoreStatus, StorePlatform } from './entities/store.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Types & Interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export interface SallaMerchantInfo {
  id: number;
  name: string;
  email?: string;
  mobile?: string;
  domain?: string;
  avatar?: string;
  plan?: string;
}

export interface SallaAppAuthorizeData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

@Injectable()
export class SallaOAuthService {
  private readonly logger = new Logger(SallaOAuthService.name);
  
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.clientId = this.configService.get<string>('SALLA_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>('SALLA_CLIENT_SECRET', '');
    this.redirectUri = this.configService.get<string>('SALLA_REDIRECT_URI', '');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 OAuth Redirect Flow
  // ═══════════════════════════════════════════════════════════════════════════════

  generateAuthorizationUrl(tenantId: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId, timestamp: Date.now() })).toString('base64');
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'offline_access',
      state,
    });

    return `https://accounts.salla.sa/oauth2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, tenantId: string): Promise<Store> {
    this.logger.log(`Exchanging code for tokens, tenantId: ${tenantId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          'https://accounts.salla.sa/oauth2/token',
          {
            grant_type: 'authorization_code',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            code,
          },
        ),
      );

      const tokens = response.data;
      const merchantInfo = await this.fetchMerchantInfo(tokens.access_token);

      let store = await this.storeRepository.findOne({
        where: { sallaMerchantId: merchantInfo.id },
      });

      if (store) {
        store.accessToken = tokens.access_token;
        store.refreshToken = tokens.refresh_token;
        store.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
        store.status = StoreStatus.ACTIVE;
        store.tenantId = tenantId;
        store.lastTokenRefreshAt = new Date();
      } else {
        store = this.storeRepository.create({
          tenantId,
          platform: StorePlatform.SALLA,
          name: merchantInfo.name || `متجر سلة ${merchantInfo.id}`,
          status: StoreStatus.ACTIVE,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          sallaMerchantId: merchantInfo.id,
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
        });
      }

      return this.storeRepository.save(store);
    } catch (error: any) {
      this.logger.error('Failed to exchange code for tokens', error.message);
      throw new BadRequestException('Failed to connect to Salla');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ⚡ Easy Mode - app.store.authorize webhook
  // ═══════════════════════════════════════════════════════════════════════════════

  async handleAppStoreAuthorize(
    merchantId: number,
    data: SallaAppAuthorizeData,
    createdAt: string,
  ): Promise<Store> {
    this.logger.log(`[Easy Mode] Processing app.store.authorize for merchant ${merchantId}`);

    try {
      const merchantInfo = await this.fetchMerchantInfo(data.access_token);

      let store = await this.storeRepository.findOne({
        where: { sallaMerchantId: merchantId },
      });

      if (store) {
        this.logger.log(`Updating existing store for merchant ${merchantId}`);
        
        store.accessToken = data.access_token;
        store.refreshToken = data.refresh_token;
        store.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
        store.status = StoreStatus.ACTIVE;
        store.sallaStoreName = merchantInfo.name;
        store.sallaEmail = merchantInfo.email;
        store.sallaMobile = merchantInfo.mobile;
        store.sallaDomain = merchantInfo.domain;
        store.sallaAvatar = merchantInfo.avatar;
        store.sallaPlan = merchantInfo.plan;
        store.lastTokenRefreshAt = new Date();
        store.lastError = undefined;
        store.consecutiveErrors = 0;
      } else {
        this.logger.log(`Creating new store for merchant ${merchantId} (Easy Mode)`);
        
        store = this.storeRepository.create({
          platform: StorePlatform.SALLA,
          name: merchantInfo.name || `متجر سلة ${merchantId}`,
          status: StoreStatus.ACTIVE,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
          sallaMerchantId: merchantId,
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
          settings: {
            connectedVia: 'easy_mode',
            connectedAt: createdAt,
          },
        });
      }

      const saved = await this.storeRepository.save(store);
      this.logger.log(`✅ Store saved: ${saved.id}, merchant: ${merchantId}`);
      return saved;
    } catch (error: any) {
      this.logger.error(`Failed to handle app.store.authorize for merchant ${merchantId}`, error.message);
      throw error;
    }
  }

  async handleAppUninstalled(merchantId: number): Promise<void> {
    this.logger.log(`Processing app.uninstalled for merchant ${merchantId}`);

    const store = await this.storeRepository.findOne({
      where: { sallaMerchantId: merchantId },
    });

    if (store) {
      store.status = StoreStatus.UNINSTALLED;
      store.accessToken = undefined;
      store.refreshToken = undefined;
      await this.storeRepository.save(store);
      this.logger.log(`Store ${store.id} marked as uninstalled`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 Link Store to Tenant
  // ═══════════════════════════════════════════════════════════════════════════════

  async linkStoreToTenant(merchantId: number, tenantId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { sallaMerchantId: merchantId },
    });

    if (!store) {
      throw new BadRequestException('Store not found');
    }

    if (store.tenantId) {
      throw new BadRequestException('Store is already linked');
    }

    store.tenantId = tenantId;
    return this.storeRepository.save(store);
  }

  async getUnlinkedStores(): Promise<Store[]> {
    return this.storeRepository
      .createQueryBuilder('store')
      .where('store.tenantId IS NULL')
      .orderBy('store.createdAt', 'DESC')
      .getMany();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Refresh
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(store: Store): Promise<Store> {
    if (!store.refreshToken) {
      throw new BadRequestException('No refresh token available');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<SallaTokenResponse>(
          'https://accounts.salla.sa/oauth2/token',
          {
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: store.refreshToken,
          },
        ),
      );

      const tokens = response.data;

      store.accessToken = tokens.access_token;
      store.refreshToken = tokens.refresh_token;
      store.tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      store.lastTokenRefreshAt = new Date();
      store.status = StoreStatus.ACTIVE;
      store.consecutiveErrors = 0;

      return this.storeRepository.save(store);
    } catch (error: any) {
      this.logger.error(`Failed to refresh token for store ${store.id}`, error.message);
      
      store.status = StoreStatus.TOKEN_EXPIRED;
      store.lastError = error.message;
      store.lastErrorAt = new Date();
      store.consecutiveErrors += 1;
      
      await this.storeRepository.save(store);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Merchant Info
  // ═══════════════════════════════════════════════════════════════════════════════

  async fetchMerchantInfo(accessToken: string): Promise<SallaMerchantInfo> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://api.salla.dev/admin/v2/oauth2/user/info', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );

      const data = response.data.data;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        domain: data.domain,
        avatar: data.avatar,
        plan: data.plan,
      };
    } catch (error: any) {
      this.logger.error('Failed to fetch merchant info', error.message);
      throw new BadRequestException('Failed to fetch merchant info');
    }
  }

  async findByMerchantId(merchantId: number): Promise<Store | null> {
    return this.storeRepository.findOne({
      where: { sallaMerchantId: merchantId },
    });
  }
}
