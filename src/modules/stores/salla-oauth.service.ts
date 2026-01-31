/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Service                            ║
 * ║                                                                                ║
 * ║  ✅ Updated: Support for Frontend CSRF state                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

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

// ✅ Updated: State data now includes Frontend CSRF state
interface StateData {
  tenantId: string;
  csrfState?: string;  // Frontend's CSRF state
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
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 Generate Authorization URL
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ Updated: Now accepts optional Frontend CSRF state
   * 
   * @param tenantId معرّف الـ Tenant
   * @param csrfState CSRF state من الـ Frontend (اختياري)
   * @returns رابط التوجيه
   */
  generateAuthorizationUrl(tenantId: string, csrfState?: string): string {
    // Generate backend state (includes tenantId + frontend csrfState)
    const state = this.generateState(tenantId, csrfState);

    const clientId = this.configService.get<string>('salla.clientId');
    const redirectUri = this.configService.get<string>('salla.redirectUri');

    const scopes = [
      'offline_access',
    ].join(' ');

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Exchange Code for Tokens
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ Updated: Returns csrfState for Frontend verification
   */
  async exchangeCodeForTokens(
    code: string,
    state: string,
  ): Promise<{ tokens: SallaTokenResponse; tenantId: string; csrfState?: string }> {
    // Verify state
    const stateData = this.verifyState(state);

    if (!stateData) {
      throw new UnauthorizedException('Invalid or expired state');
    }

    const { tenantId, csrfState } = stateData;

    try {
      const clientId = this.configService.get<string>('salla.clientId');
      const clientSecret = this.configService.get<string>('salla.clientSecret');
      const redirectUri = this.configService.get<string>('salla.redirectUri');

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
        csrfState,  // ✅ Return Frontend's CSRF state
      };

    } catch (error: any) {
      this.logger.error('Failed to exchange code for tokens', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Refresh Access Token
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<SallaTokenResponse> {
    try {
      const clientId = this.configService.get<string>('salla.clientId');
      const clientSecret = this.configService.get<string>('salla.clientSecret');

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
  // 📊 Get Merchant Info
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

  /**
   * ✅ Updated: Now stores Frontend CSRF state
   */
  private generateState(tenantId: string, csrfState?: string): string {
    const state = crypto.randomBytes(32).toString('hex');

    // ✅ Store tenantId + Frontend's csrfState
    this.stateStorage.set(state, {
      tenantId,
      csrfState,
      expiresAt: Date.now() + 10 * 60 * 1000,  // 10 minutes
    });

    this.cleanupExpiredStates();

    return state;
  }

  /**
   * ✅ Updated: Returns csrfState
   */
  private verifyState(state: string): StateData | null {
    const stateData = this.stateStorage.get(state);

    if (!stateData) {
      return null;
    }

    // Single use
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
