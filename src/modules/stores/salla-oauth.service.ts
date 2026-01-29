/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Service                            ║
 * ║                                                                                ║
 * ║  خدمة OAuth للربط مع سلة                                                        ║
 * ║  تتولى كل شيء متعلق بالـ authorization                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

/**
 * 📌 OAuth 2.0 - شرح مبسط:
 * 
 * OAuth = معيار للسماح لتطبيق بالوصول لحساب المستخدم في تطبيق آخر
 * بدون الحاجة لمعرفة كلمة المرور
 * 
 * الأطراف:
 * 1. Resource Owner: المستخدم (صاحب المتجر)
 * 2. Client: تطبيقنا (رفيق)
 * 3. Authorization Server: سلة
 * 4. Resource Server: API سلة
 * 
 * Flow:
 * 1. نوجه المستخدم لسلة للموافقة
 * 2. سلة تعطينا code
 * 3. نستبدل الـ code بـ tokens
 * 4. نستخدم الـ tokens للوصول للـ API
 */

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
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

@Injectable()
export class SallaOAuthService {
  private readonly logger = new Logger(SallaOAuthService.name);

  // Salla OAuth endpoints
  private readonly SALLA_AUTH_URL = 'https://accounts.salla.sa/oauth2/authorize';
  private readonly SALLA_TOKEN_URL = 'https://accounts.salla.sa/oauth2/token';
  private readonly SALLA_API_URL = 'https://api.salla.dev/admin/v2';

  // State storage (يجب استخدام Redis في الإنتاج)
  private readonly stateStorage = new Map<string, { tenantId: string; expiresAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 Generate Authorization URL
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * إنشاء رابط OAuth لسلة
   * 
   * @param tenantId معرّف الـ Tenant
   * @returns رابط التوجيه
   */
  generateAuthorizationUrl(tenantId: string): string {
    // ─────────────────────────────────────────────────────────────────────────────
    // 1️⃣ إنشاء State (لمنع CSRF)
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * State = قيمة عشوائية نرسلها لسلة
     * سلة ترجعها مع الـ callback
     * نتحقق أنها نفسها = الطلب أصلي
     * 
     * لماذا مهم؟
     * بدون state، مهاجم يمكنه:
     * 1. إنشاء رابط OAuth
     * 2. إقناع الضحية بالضغط عليه
     * 3. ربط متجر الضحية بحساب المهاجم
     */
    const state = this.generateState(tenantId);

    // ─────────────────────────────────────────────────────────────────────────────
    // 2️⃣ بناء URL
    // ─────────────────────────────────────────────────────────────────────────────
    const clientId = this.configService.get<string>('salla.clientId');
    const redirectUri = this.configService.get<string>('salla.redirectUri');

    /**
     * Scopes تحدد ما يمكن لتطبيقنا الوصول له:
     * - offline_access: للحصول على refresh_token
     */
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
   * استبدال الـ code بـ tokens
   * 
   * @param code الـ code من سلة
   * @param state الـ state للتحقق
   */
  async exchangeCodeForTokens(
    code: string,
    state: string,
  ): Promise<{ tokens: SallaTokenResponse; tenantId: string }> {
    // ─────────────────────────────────────────────────────────────────────────────
    // 1️⃣ التحقق من الـ State
    // ─────────────────────────────────────────────────────────────────────────────
    const stateData = this.verifyState(state);

    if (!stateData) {
      throw new UnauthorizedException('Invalid or expired state');
    }

    const { tenantId } = stateData;

    // ─────────────────────────────────────────────────────────────────────────────
    // 2️⃣ استبدال الـ Code بـ Tokens
    // ─────────────────────────────────────────────────────────────────────────────
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
      };

    } catch (error) {
      this.logger.error('Failed to exchange code for tokens', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Refresh Access Token
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * تجديد الـ Access Token
   * 
   * يُستدعى عندما يكون الـ token قارب على الانتهاء
   */
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

    } catch (error) {
      this.logger.error('Failed to refresh access token', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw new UnauthorizedException('Failed to refresh access token');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 Get Merchant Info
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * جلب معلومات المتجر من API سلة
   */
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

    } catch (error) {
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
   * إنشاء State عشوائي وآمن
   */
  private generateState(tenantId: string): string {
    // إنشاء state عشوائي
    const state = crypto.randomBytes(32).toString('hex');

    // حفظه مع الـ tenantId ووقت الانتهاء (10 دقائق)
    this.stateStorage.set(state, {
      tenantId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    // تنظيف الـ states المنتهية
    this.cleanupExpiredStates();

    return state;
  }

  /**
   * التحقق من الـ State
   */
  private verifyState(state: string): { tenantId: string } | null {
    const stateData = this.stateStorage.get(state);

    if (!stateData) {
      return null;
    }

    // حذف الـ state بعد الاستخدام (single use)
    this.stateStorage.delete(state);

    // التحقق من عدم انتهاء الصلاحية
    if (Date.now() > stateData.expiresAt) {
      return null;
    }

    return { tenantId: stateData.tenantId };
  }

  /**
   * تنظيف الـ States المنتهية
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of this.stateStorage.entries()) {
      if (now > data.expiresAt) {
        this.stateStorage.delete(state);
      }
    }
  }

  /**
   * حساب تاريخ انتهاء الـ Token
   */
  calculateTokenExpiry(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
  }
}

/**
 * 📌 ملاحظات أمنية:
 * 
 * 1. State Storage:
 *    - في الإنتاج، يجب استخدام Redis بدلاً من Map
 *    - Map يُفقد عند إعادة تشغيل السيرفر
 * 
 * 2. Token Storage:
 *    - الـ tokens يجب تشفيرها قبل حفظها في DB
 *    - استخدم encryption-at-rest
 * 
 * 3. HTTPS:
 *    - كل الـ redirects يجب أن تكون عبر HTTPS
 *    - لا ترسل tokens عبر HTTP أبداً
 * 
 * 4. Token Rotation:
 *    - عند تجديد الـ token، سلة قد تعطي refresh_token جديد
 *    - يجب حفظه واستخدامه في المرة القادمة
 */
