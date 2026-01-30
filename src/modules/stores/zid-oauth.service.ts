/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid OAuth Service                              ║
 * ║                                                                                ║
 * ║  خدمة OAuth للربط مع زد                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

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
  mobile: string;
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
  ) {}

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

  /**
   * تجديد Access Token
   */
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

  /**
   * جلب بيانات المتجر من زد
   */
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

  private generateState(tenantId: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    this.stateStorage.set(state, {
      tenantId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    this.cleanupExpiredStates();
    return state;
  }

  private validateState(state: string): string {
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
