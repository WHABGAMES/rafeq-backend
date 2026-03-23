/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Service                          ║
 * ║                                                                              ║
 * ║  ✅ OAuth 2.0 Flow مع سلة                                                       ║
 * ║  ✅ يدعم Easy Mode و Standard OAuth و Custom Mode                             ║
 * ║  ✅ Auto Registration - إنشاء حساب تلقائي للتاجر                               ║
 * ║  ✅ Multi-Store — تاجر موجود يُربط متجره الجديد على نفس tenant                 ║
 * ║  🔐 NEW: تشفير التوكنات بـ AES-256-GCM                                         ║
 * ║                                                                              ║
 * ║  📁 src/modules/stores/salla-oauth.service.ts                                ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';

import { Store, StoreStatus, StorePlatform } from './entities/store.entity';
import { AutoRegistrationService } from '../auth/auto-registration.service';

// 🔐 Encryption
import { encrypt } from '@common/utils/encryption.util';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Exported Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * ✅ معلومات التاجر من سلة API (مدمجة من مصدرين)
 *
 * 📌 مصدران للبيانات:
 *   1. GET /admin/v2/store/info    → بيانات المتجر (email, mobile = بيانات المتجر)
 *   2. GET /oauth2/user/info       → بيانات المالك الشخصية (email, mobile = الشخصي)
 *
 * ⚠️ email & mobile هنا = بيانات المتجر (store/info) — للتخزين في Store record
 * ✅ ownerEmail & ownerMobile = بيانات المالك الشخصية — لإنشاء الحساب وبيانات الدخول
 */
export interface SallaMerchantInfo {
  /** معرّف المتجر في سلة */
  id: number;
  /** اسم المتجر */
  name: string;
  username?: string;
  /** إيميل المتجر من store/info (قد يكون support@salla.dev) — لا يُستخدم لإنشاء الحساب */
  email: string;
  /** رقم هاتف المتجر من store/info — ليس الشخصي بالضرورة */
  mobile?: string;
  domain: string;
  plan: string;
  avatar?: string;

  // ═══════════════════════════════════════════════════════════════
  // 👤 بيانات المالك الشخصية (من oauth2/user/info)
  // هذه هي البيانات الصحيحة لإنشاء الحساب وإرسال بيانات الدخول
  // ═══════════════════════════════════════════════════════════════

  /** ✅ الإيميل الشخصي للتاجر — يُستخدم لإنشاء الحساب */
  ownerEmail?: string;
  /** ✅ رقم الجوال الشخصي للتاجر — يُستخدم لإرسال واتساب */
  ownerMobile?: string;
  /** ✅ اسم التاجر الشخصي */
  ownerName?: string;
}

export interface OAuthResult {
  tokens: SallaTokenResponse;
  tenantId: string;
  merchantId: number;
}

/**
 * ✅ بيانات app.store.authorize من webhook سلة
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

  /**
   * ✅ Endpoint لجلب بيانات المالك الشخصية
   *
   * ⚠️ ملاحظة مهمة:
   *   - auth.service.ts يستخدم نفس الـ endpoint وهو يعمل بنجاح
   *   - هذا الـ endpoint يرجع: { data: { id, email, name, mobile, avatar, ... } }
   *   - الإيميل هنا هو الإيميل الشخصي للتاجر (وليس إيميل المتجر)
   */
  private readonly sallaUserInfoUrl = 'https://api.salla.dev/admin/v2/oauth2/user/info';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly tenantsService: TenantsService,
    private readonly autoRegistrationService: AutoRegistrationService,
  ) {
    this.clientId = this.configService.getOrThrow<string>('SALLA_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('SALLA_CLIENT_SECRET');
    this.redirectUri = this.configService.getOrThrow<string>('SALLA_REDIRECT_URI');
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 OAuth URL Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  generateAuthorizationUrl(tenantId: string, customState?: string): string {
    // 🔧 FIX H-01: HMAC-signed state parameter to prevent CSRF
    const stateData = {
      tenantId,
      custom: customState || '',
      ts: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(stateData)).toString('base64url');
    const secret = this.configService.get('JWT_SECRET', '');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encoded)
      .digest('hex');
    const state = `${encoded}.${signature}`;

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'offline_access',
      state,
    });

    const url = `${this.sallaAuthUrl}?${params.toString()}`;
    this.logger.log(`Generated OAuth URL for tenant ${tenantId}`);
    return url;
  }

  decodeState(state: string): { tenantId: string; custom: string } {
    try {
      // 🔧 FIX H-01: Verify HMAC signature before decoding
      const [encoded, signature] = state.split('.');
      if (!encoded || !signature) {
        throw new Error('Invalid state format');
      }

      const secret = this.configService.get('JWT_SECRET', '');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(encoded)
        .digest('hex');

      // Timing-safe comparison
      if (signature.length !== expectedSignature.length ||
          !crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex'),
          )) {
        throw new Error('Invalid state signature');
      }

      // Verify timestamp (10 minute window)
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      const MAX_AGE = 10 * 60 * 1000;
      if (Date.now() - decoded.ts > MAX_AGE) {
        throw new Error('State parameter expired');
      }

      return { tenantId: decoded.tenantId, custom: decoded.custom || '' };
    } catch (error) {
      // ✅ FIX: DEBUG وليس ERROR — state من سلة (غير موقّع) هو سلوك متوقع
      // يحدث عند تثبيت التطبيق من متجر سلة (وليس من الداشبورد)
      this.logger.debug('State is not HMAC-signed — likely Salla-generated state');
      throw new BadRequestException('Invalid or expired state parameter');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 Store Lookup Helper
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ البحث عن متجر بـ sallaMerchantId
   * يستخدم Raw SQL لتجاوز مشاكل TypeORM مع bigint
   */
  private async findStoreBySallaMerchantId(merchantId: number): Promise<Store | null> {
    // Raw SQL → PostgreSQL handles bigint comparison directly
    const rows: Array<{ id: string; deleted_at: Date | null }> =
      await this.storeRepository.manager.query(
        `SELECT id, deleted_at FROM stores WHERE salla_merchant_id = $1 LIMIT 1`,
        [merchantId],
      );

    if (!rows || rows.length === 0) {
      this.logger.warn(`❌ Merchant ${merchantId}: not found in stores (raw SQL)`);
      return null;
    }

    // Restore if soft-deleted
    if (rows[0].deleted_at) {
      this.logger.warn(`🔄 RECOVERY: Restoring soft-deleted store ${rows[0].id} for merchant ${merchantId}`);
      await this.storeRepository.manager.query(
        `UPDATE stores SET deleted_at = NULL, status = 'active' WHERE id = $1`,
        [rows[0].id],
      );
    }

    // Load entity by UUID (zero type issues)
    return this.storeRepository.findOne({ where: { id: rows[0].id } });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 Token Exchange
  // ═══════════════════════════════════════════════════════════════════════════════

  async exchangeCodeForTokens(code: string, tenantId: string): Promise<OAuthResult> {
    this.logger.log('Exchanging code for tokens');

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
      await this.assertTenantOwnerIdentityMatch(tenantId, merchantInfo);

      let store = await this.findStoreBySallaMerchantId(merchantInfo.id);

      if (store) {
        if (store.tenantId && store.tenantId !== tenantId) {
          throw new ConflictException(
            'هذا المتجر مربوط مسبقاً بتاجر آخر، ولا يمكن ربطه على هذا الحساب.',
          );
        }
        store.tenantId = tenantId;
        // 🔐 تشفير التوكنات
        store.accessToken = encrypt(tokens.access_token) ?? undefined;
        store.refreshToken = encrypt(tokens.refresh_token) ?? undefined;
        store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
        store.lastTokenRefreshAt = new Date();
        store.status = StoreStatus.ACTIVE;
        store.consecutiveErrors = 0;
        store.lastError = undefined;
        
        // بيانات المتجر
        store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
        store.sallaEmail = merchantInfo.email || store.sallaEmail;
        store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
        store.sallaDomain = merchantInfo.domain || store.sallaDomain;
        store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
        store.sallaPlan = merchantInfo.plan || store.sallaPlan;

        // ✅ بيانات المالك الشخصية
        if (merchantInfo.ownerEmail) store.sallaOwnerEmail = merchantInfo.ownerEmail;
        if (merchantInfo.ownerMobile) store.sallaOwnerMobile = merchantInfo.ownerMobile;
        if (merchantInfo.ownerName) store.sallaOwnerName = merchantInfo.ownerName;
        
        this.logger.log(`Updated existing store: ${store.id}`);
      } else {
        store = this.storeRepository.create({
          tenantId,
          name: merchantInfo.name || merchantInfo.username || `متجر سلة ${merchantInfo.id}`,
          platform: StorePlatform.SALLA,
          status: StoreStatus.ACTIVE,
          sallaMerchantId: merchantInfo.id,
          // 🔐 تشفير التوكنات
          accessToken: encrypt(tokens.access_token) ?? undefined,
          refreshToken: encrypt(tokens.refresh_token) ?? undefined,
          tokenExpiresAt: this.calculateTokenExpiry(tokens.expires_in),
          // بيانات المتجر
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
          // ✅ بيانات المالك الشخصية
          sallaOwnerEmail: merchantInfo.ownerEmail,
          sallaOwnerMobile: merchantInfo.ownerMobile,
          sallaOwnerName: merchantInfo.ownerName,
          lastSyncedAt: new Date(),
          settings: {},
          subscribedEvents: [],
        });

        this.logger.log(`Created new store for merchant ${merchantInfo.id}`);
      }

      await this.storeRepository.save(store);

      this.logger.log(`OAuth completed for tenant ${tenantId}, merchant ${merchantInfo.id}`);

      return {
        tokens,
        tenantId,
        merchantId: merchantInfo.id,
      };
    } catch (error: any) {
      this.logger.error('Failed to exchange code for tokens', { error: error.response?.data || error.message });
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 Custom Mode — تثبيت من متجر سلة (بدون tenantId)
  // ✅ FIX: إذا التاجر موجود بالإيميل → نستخدم tenant-ه الحالي
  // ═══════════════════════════════════════════════════════════════════════════════

  async exchangeCodeAndAutoRegister(code: string): Promise<{
    merchantId: number;
    isNewUser: boolean;
    email: string;
  }> {
    this.logger.log('🆕 exchangeCodeAndAutoRegister — Salla store install');

    try {
      // 1. استبدال code بـ tokens
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

      // 2. جلب بيانات التاجر
      const merchantInfo = await this.fetchMerchantInfo(tokens.access_token);
      this.logger.log(`📊 Merchant: ${merchantInfo.id} — ${merchantInfo.name}`);

      // 3. البحث عن متجر موجود أو إنشاء جديد
      const sallaMerchantId = merchantInfo.id; // ✅ Use number type as expected
      let store = await this.findStoreBySallaMerchantId(sallaMerchantId);

      let isNewStore = false;

      if (store) {
        // ════════════════════════════════════════════════════════════════════
        // 🔄 UPDATE existing store (re-installation scenario)
        // ════════════════════════════════════════════════════════════════════
        this.logger.log(`🔄 Updating existing Salla store: ${sallaMerchantId} (DB ID: ${store.id})`);

        this.updateSallaStoreFields(store, tokens, merchantInfo);

        // إذا ما عنده tenant → نحل المشكلة
        if (!store.tenantId) {
          const tenantId = await this.resolveOrCreateTenant(merchantInfo);
          store.tenantId = tenantId;
          this.logger.log(`🔗 Linking store to tenant ${tenantId}`);
        }
      } else {
        // ════════════════════════════════════════════════════════════════════
        // 🆕 CREATE new store (first-time installation)
        // ════════════════════════════════════════════════════════════════════
        isNewStore = true;
        this.logger.log(`🆕 Creating new Salla store: ${sallaMerchantId}`);

        const tenantId = await this.resolveOrCreateTenant(merchantInfo);

        store = this.storeRepository.create({
          tenantId,
          name: merchantInfo.name || merchantInfo.username || `متجر سلة ${sallaMerchantId}`,
          platform: StorePlatform.SALLA,
          status: StoreStatus.ACTIVE,
          sallaMerchantId,
          accessToken: encrypt(tokens.access_token) ?? undefined,
          refreshToken: encrypt(tokens.refresh_token) ?? undefined,
          tokenExpiresAt: this.calculateTokenExpiry(tokens.expires_in),
          // بيانات المتجر
          sallaStoreName: merchantInfo.name,
          sallaEmail: merchantInfo.email,
          sallaMobile: merchantInfo.mobile,
          sallaDomain: merchantInfo.domain,
          sallaAvatar: merchantInfo.avatar,
          sallaPlan: merchantInfo.plan,
          // ✅ بيانات المالك الشخصية
          sallaOwnerEmail: merchantInfo.ownerEmail,
          sallaOwnerMobile: merchantInfo.ownerMobile,
          sallaOwnerName: merchantInfo.ownerName,
          lastSyncedAt: new Date(),
          lastTokenRefreshAt: new Date(),
          settings: {},
          subscribedEvents: [],
        });
      }

      // ═════════════════════════════════════════════════════════════════════
      // 💾 Save store (with duplicate key handling)
      // ═════════════════════════════════════════════════════════════════════
      let savedStore: Store;
      try {
        savedStore = await this.storeRepository.save(store);
        
        if (isNewStore) {
          this.logger.log(`✅ Salla store created: ${sallaMerchantId} → tenant ${store.tenantId}`);
        } else {
          this.logger.log(`✅ Salla store updated: ${sallaMerchantId} → tenant ${store.tenantId}`);
        }
      } catch (saveError: any) {
        // Handle duplicate key constraint violation (race condition)
        if (saveError.code === '23505' || saveError.message?.includes('duplicate key')) {
          this.logger.warn(`⚠️ Duplicate key detected for ${sallaMerchantId}, re-querying and updating...`);
          
          // Re-query the existing store
          const existingStore = await this.findStoreBySallaMerchantId(sallaMerchantId);
          
          if (!existingStore) {
            // This shouldn't happen, but handle it anyway
            throw saveError;
          }
          
          // Update the existing store using shared logic
          this.updateSallaStoreFields(existingStore, tokens, merchantInfo);
          
          if (!existingStore.tenantId && store.tenantId) {
            existingStore.tenantId = store.tenantId;
            this.logger.log(`🔗 Linking store to tenant ${store.tenantId}`);
          }
          
          savedStore = await this.storeRepository.save(existingStore);
          this.logger.log(`✅ Salla store updated after retry: ${sallaMerchantId} → tenant ${savedStore.tenantId}`);
        } else {
          throw saveError;
        }
      }

      // 4. إنشاء/تحديث المستخدم + إرسال بيانات الدخول (إيميل + واتساب)
      // ✅ استخدام بيانات المالك الشخصية (وليس بيانات المتجر)
      const ownerEmail = this.getOwnerEmail(merchantInfo);
      const ownerMobile = this.getOwnerMobile(merchantInfo);
      const ownerName = this.getOwnerName(merchantInfo);

      let isNewUser = false;
      try {
        const regResult = await this.autoRegistrationService.handleAppInstallation(
          {
            merchantId: merchantInfo.id,
            email: ownerEmail,           // ✅ إيميل المالك الشخصي
            mobile: ownerMobile,         // ✅ جوال المالك الشخصي
            name: ownerName,             // ✅ اسم المالك الشخصي
            storeName: merchantInfo.name,
            avatar: merchantInfo.avatar,
            platform: 'salla',
          },
          savedStore,
        );
        isNewUser = regResult.isNewUser;

        this.logger.log(`✅ Auto-registration: ${regResult.message}`, {
          userId: regResult.userId,
          isNewUser: regResult.isNewUser,
          ownerEmail,
        });
      } catch (error: any) {
        this.logger.error(`❌ Auto-registration failed: ${error.message}`, {
          merchantId: merchantInfo.id,
          ownerEmail,
          storeEmail: merchantInfo.email,
        });
      }

      return {
        merchantId: merchantInfo.id,
        isNewUser,
        email: ownerEmail,  // ✅ إرجاع إيميل المالك الشخصي
      };

    } catch (error: any) {
      this.logger.error('Failed exchangeCodeAndAutoRegister', {
        error: error.response?.data || error.message,
      });
      throw new BadRequestException('Failed to complete Salla store installation');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 Merchant Info — يجمع بيانات المتجر + بيانات المالك الشخصية
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ جلب بيانات التاجر الكاملة من مصدرين:
   *
   * 1. GET /admin/v2/store/info (سلة Store API)
   *    → id, name, email (إيميل المتجر), mobile (هاتف المتجر), domain, plan, avatar
   *    ⚠️ email هنا = إيميل المتجر (مثل support@salla.dev) وليس إيميل التاجر
   *
   * 2. GET /oauth2/user/info (سلة OAuth API)
   *    → email (الإيميل الشخصي), mobile (الجوال الشخصي), name (الاسم الشخصي)
   *    ✅ هذه البيانات الصحيحة لإنشاء الحساب
   *
   * 🐛 BUG المُصلَح: النظام كان يستخدم store/info فقط
   *    → إيميل المتجر (support@salla.dev) بدل إيميل التاجر الحقيقي
   *    → كل الحسابات تُنشأ بإيميل خاطئ
   */
  async fetchMerchantInfo(accessToken: string): Promise<SallaMerchantInfo> {
    // ─── 1. جلب بيانات المتجر (store/info) ───
    let storeData: any;
    try {
      const storeResponse = await firstValueFrom(
        this.httpService.get(`${this.sallaApiUrl}/store/info`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
      storeData = storeResponse.data.data;
    } catch (error: any) {
      this.logger.error('Failed to fetch store info from Salla', error.message);
      throw new BadRequestException('Failed to fetch store information from Salla');
    }

    // ─── 2. جلب بيانات المالك الشخصية (user/info) ───
    let userData: { email?: string; mobile?: string; name?: string } = {};
    try {
      const userResponse = await firstValueFrom(
        this.httpService.get(this.sallaUserInfoUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );

      const userPayload = userResponse.data?.data || userResponse.data;

      userData = {
        email: userPayload?.email || undefined,
        mobile: userPayload?.mobile || userPayload?.phone || undefined,
        name: userPayload?.name
          || [userPayload?.first_name, userPayload?.last_name].filter(Boolean).join(' ')
          || undefined,
      };

      this.logger.log(`👤 Salla user/info fetched`, {
        ownerEmail: userData.email || '(none)',
        ownerMobile: userData.mobile ? '✓' : '(none)',
        ownerName: userData.name || '(none)',
      });
    } catch (error: any) {
      // ⚠️ user/info قد يفشل في بعض الحالات (scope محدود، متجر تجريبي)
      // لا نوقف العملية — نسجل تحذير ونكمل ببيانات المتجر كـ fallback
      this.logger.warn(
        `⚠️ Failed to fetch user/info from Salla OAuth — will fallback to store email`,
        {
          status: error.response?.status,
          error: error.response?.data?.error || error.message,
          hint: 'This is expected for some test stores or limited OAuth scopes',
        },
      );
    }

    // ─── 3. تجميع البيانات ───
    const result: SallaMerchantInfo = {
      // بيانات المتجر (من store/info)
      id: storeData.id,
      name: storeData.name,
      username: storeData.username,
      email: storeData.email,       // إيميل المتجر
      mobile: storeData.mobile,     // هاتف المتجر
      domain: storeData.domain,
      plan: storeData.plan,
      avatar: storeData.avatar,

      // بيانات المالك الشخصية (من user/info)
      ownerEmail: userData.email || undefined,
      ownerMobile: userData.mobile || undefined,
      ownerName: userData.name || undefined,
    };

    // ─── 4. تسجيل مقارنة الإيميلات لأغراض الـ debugging ───
    if (result.ownerEmail && result.email !== result.ownerEmail) {
      this.logger.log(
        `📧 Email mismatch detected (expected): store="${result.email}" vs owner="${result.ownerEmail}"`,
      );
    } else if (!result.ownerEmail) {
      this.logger.warn(
        `⚠️ No owner email available — will use store email "${result.email}" as fallback`,
      );
    }

    return result;
  }

  /**
   * ✅ Helper: يرجع الإيميل الصحيح لإنشاء الحساب
   *
   * الأولوية: ownerEmail (شخصي) > email (متجر)
   *
   * يُستخدم في: resolveOrCreateTenant, handleAppInstallation, وأي مكان
   *              يحتاج الإيميل الحقيقي للتاجر
   */
  private getOwnerEmail(merchantInfo: SallaMerchantInfo): string {
    return merchantInfo.ownerEmail || merchantInfo.email;
  }

  private normalizeEmail(email?: string | null): string {
    return (email || '').trim().toLowerCase();
  }

  private async getTenantPrimaryOwnerEmail(tenantId: string): Promise<string | null> {
    const rows = await this.storeRepository.manager.query(
      `
      SELECT email
      FROM users
      WHERE tenant_id = $1
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN role = 'owner' THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1
      `,
      [tenantId],
    );

    const email = this.normalizeEmail(rows?.[0]?.email);
    return email || null;
  }

  private async assertTenantOwnerIdentityMatch(
    tenantId: string,
    merchantInfo: SallaMerchantInfo,
  ): Promise<void> {
    const tenantOwnerEmail = await this.getTenantPrimaryOwnerEmail(tenantId);
    const incomingOwnerEmail = this.normalizeEmail(this.getOwnerEmail(merchantInfo));

    if (!tenantOwnerEmail || !incomingOwnerEmail) return;
    if (tenantOwnerEmail === incomingOwnerEmail) return;

    this.logger.warn(
      `⛔ Tenant owner mismatch on Salla connect: tenant=${tenantId}, tenantOwner=${tenantOwnerEmail}, incomingOwner=${incomingOwnerEmail}, merchant=${merchantInfo.id}`,
    );
    throw new ConflictException(
      'هذا المتجر يتبع تاجرًا آخر (اختلاف إيميل المالك)، ولا يمكن ربطه بهذا الحساب.',
    );
  }

  /**
   * ✅ Helper: يرجع رقم الجوال الصحيح للتاجر
   */
  private getOwnerMobile(merchantInfo: SallaMerchantInfo): string | undefined {
    return merchantInfo.ownerMobile || merchantInfo.mobile;
  }

  /**
   * ✅ Helper: يرجع اسم التاجر الصحيح
   */
  private getOwnerName(merchantInfo: SallaMerchantInfo): string {
    return merchantInfo.ownerName || merchantInfo.name || merchantInfo.username || 'تاجر';
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Refresh
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<SallaTokenResponse> {
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

      this.logger.log('Access token refreshed successfully');
      return response.data;
    } catch (error: any) {
      this.logger.error('Failed to refresh token', error.message);
      throw new BadRequestException('Failed to refresh access token');
    }
  }

  public calculateTokenExpiry(expiresIn: number): Date {
    return new Date(Date.now() + expiresIn * 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔌 Easy Mode - Webhook Handlers
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * ✅ معالجة app.store.authorize من webhook سلة
   * ✅ FIX: إذا التاجر موجود → نستخدم tenant-ه الحالي بدل إنشاء جديد
   */
  async handleAppStoreAuthorize(
    merchantId: number,
    data: SallaAppAuthorizeData,
    createdAt: string,
  ): Promise<Store> {
    this.logger.log(`🚀 App Store authorize for merchant ${merchantId}`, { createdAt });

    const merchantInfo = await this.fetchMerchantInfo(data.access_token);
    let store = await this.findStoreBySallaMerchantId(merchantId);
    const expiresIn = data.expires || 3600;

    if (store) {
      // متجر موجود (نفس merchantId) — تحديث التوكنات
      if (!store.tenantId) {
        const tenantId = await this.resolveOrCreateTenant(merchantInfo);
        store.tenantId = tenantId;
      }
      
      // 🔐 تشفير التوكنات
      store.accessToken = encrypt(data.access_token) ?? undefined;
      store.refreshToken = encrypt(data.refresh_token) ?? undefined;
      store.tokenExpiresAt = this.calculateTokenExpiry(expiresIn);
      store.lastTokenRefreshAt = new Date();
      store.status = StoreStatus.ACTIVE;
      store.consecutiveErrors = 0;
      store.lastError = undefined;

      // بيانات المتجر
      store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
      store.sallaEmail = merchantInfo.email || store.sallaEmail;
      store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
      store.sallaDomain = merchantInfo.domain || store.sallaDomain;
      store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
      store.sallaPlan = merchantInfo.plan || store.sallaPlan;

      // ✅ بيانات المالك الشخصية
      if (merchantInfo.ownerEmail) store.sallaOwnerEmail = merchantInfo.ownerEmail;
      if (merchantInfo.ownerMobile) store.sallaOwnerMobile = merchantInfo.ownerMobile;
      if (merchantInfo.ownerName) store.sallaOwnerName = merchantInfo.ownerName;
      
      this.logger.log(`📦 Updated store for merchant ${merchantId}`);
    } else {
      // ✅ FIX: متجر جديد — نتحقق هل التاجر موجود أولاً
      const tenantId = await this.resolveOrCreateTenant(merchantInfo);

      store = this.storeRepository.create({
        tenantId,
        name: merchantInfo.name || merchantInfo.username || `متجر سلة`,
        platform: StorePlatform.SALLA,
        status: StoreStatus.ACTIVE,
        sallaMerchantId: merchantId,
        // 🔐 تشفير التوكنات
        accessToken: encrypt(data.access_token) ?? undefined,
        refreshToken: encrypt(data.refresh_token) ?? undefined,
        tokenExpiresAt: this.calculateTokenExpiry(expiresIn),
        // بيانات المتجر
        sallaStoreName: merchantInfo.name,
        sallaEmail: merchantInfo.email,
        sallaMobile: merchantInfo.mobile,
        sallaDomain: merchantInfo.domain,
        sallaAvatar: merchantInfo.avatar,
        sallaPlan: merchantInfo.plan,
        // ✅ بيانات المالك الشخصية
        sallaOwnerEmail: merchantInfo.ownerEmail,
        sallaOwnerMobile: merchantInfo.ownerMobile,
        sallaOwnerName: merchantInfo.ownerName,
        lastSyncedAt: new Date(),
        settings: {},
        subscribedEvents: [],
      });

      this.logger.log(`🆕 Created new store for merchant ${merchantId} → tenant ${tenantId}`);
    }

    const savedStore = await this.storeRepository.save(store);

    // 👤 إنشاء/تحديث المستخدم + إرسال بيانات الدخول
    // ✅ FIX PERF: يُنفَّذ بشكل غير متزامن بعد الرد على سلة فوراً
    // ✅ FIX EMAIL: يستخدم إيميل المالك الشخصي (وليس إيميل المتجر)
    const ownerEmail = this.getOwnerEmail(merchantInfo);
    const ownerMobile = this.getOwnerMobile(merchantInfo);
    const ownerName = this.getOwnerName(merchantInfo);

    setImmediate(async () => {
      try {
        const result = await this.autoRegistrationService.handleAppInstallation(
          {
            merchantId,
            email: ownerEmail,           // ✅ إيميل المالك الشخصي
            mobile: ownerMobile,         // ✅ جوال المالك الشخصي
            name: ownerName,             // ✅ اسم المالك الشخصي
            storeName: merchantInfo.name,
            avatar: merchantInfo.avatar,
            platform: 'salla',
          },
          savedStore,
        );

        this.logger.log(`✅ Auto-registration completed`, {
          merchantId,
          userId: result.userId,
          isNewUser: result.isNewUser,
          ownerEmail,
        });
      } catch (error: any) {
        this.logger.error(`❌ Auto-registration failed: ${error.message}`, {
          merchantId,
          ownerEmail,
          storeEmail: merchantInfo.email,
        });
      }
    });

    return savedStore;
  }

  /**
   * ✅ معالجة app.uninstalled
   */
  async handleAppUninstalled(merchantId: number): Promise<void> {
    this.logger.log(`App uninstalled for merchant ${merchantId}`);
    const store = await this.findStoreBySallaMerchantId(merchantId);
    if (store) {
      store.status = StoreStatus.UNINSTALLED;
      store.accessToken = undefined;
      store.refreshToken = undefined;
      store.tokenExpiresAt = undefined;
      await this.storeRepository.save(store);
      this.logger.log(`Store uninstalled for merchant ${merchantId}`);
    }
  }

  /**
   * ✅ ربط متجر بـ tenant
   */
  async linkStoreToTenant(storeId: string, tenantId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new BadRequestException('Store not found');
    }
    store.tenantId = tenantId;
    this.logger.log(`Linked store ${storeId} to tenant ${tenantId}`);
    return this.storeRepository.save(store);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX: البحث عن tenant موجود أو إنشاء جديد
  //
  // المنطق:
  // 1. البحث عن المستخدم بالإيميل
  // 2. إذا موجود وعنده tenantId → نستخدمه (المتجر الجديد يُربط على نفس الحساب)
  // 3. إذا جديد → ننشئ tenant جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Helper method to update an existing Salla store with new tokens and info
   * Used both in normal update path and duplicate key retry path
   */
  private updateSallaStoreFields(
    store: Store,
    tokens: SallaTokenResponse,
    merchantInfo: SallaMerchantInfo,
  ): void {
    store.accessToken = encrypt(tokens.access_token) ?? undefined;
    store.refreshToken = encrypt(tokens.refresh_token) ?? undefined;
    store.tokenExpiresAt = this.calculateTokenExpiry(tokens.expires_in);
    store.lastTokenRefreshAt = new Date();
    store.status = StoreStatus.ACTIVE;
    store.consecutiveErrors = 0;
    store.lastError = undefined;

    // بيانات المتجر (من store/info)
    store.sallaStoreName = merchantInfo.name || store.sallaStoreName;
    store.sallaEmail = merchantInfo.email || store.sallaEmail;
    store.sallaMobile = merchantInfo.mobile || store.sallaMobile;
    store.sallaDomain = merchantInfo.domain || store.sallaDomain;
    store.sallaAvatar = merchantInfo.avatar || store.sallaAvatar;
    store.sallaPlan = merchantInfo.plan || store.sallaPlan;

    // ✅ بيانات المالك الشخصية (من user/info)
    if (merchantInfo.ownerEmail) {
      store.sallaOwnerEmail = merchantInfo.ownerEmail;
    }
    if (merchantInfo.ownerMobile) {
      store.sallaOwnerMobile = merchantInfo.ownerMobile;
    }
    if (merchantInfo.ownerName) {
      store.sallaOwnerName = merchantInfo.ownerName;
    }
  }

  private async resolveOrCreateTenant(merchantInfo: SallaMerchantInfo): Promise<string> {
    const ownerEmail = this.getOwnerEmail(merchantInfo);
    const ownerMobile = this.getOwnerMobile(merchantInfo);

    // ════════════════════════════════════════════════════════════════════
    // ✅ FIX CRITICAL: البحث بـ merchantId أولاً (وليس بالإيميل!)
    //
    // المشكلة القديمة: البحث بالإيميل كان يربط متاجر تجار مختلفين
    //   على نفس الـ tenant إذا صدفة يستخدمون نفس الإيميل!
    //
    // الحل: كل sallaMerchantId في سلة = tenant مستقل في رفيق
    //   حتى لو نفس الشخص يملك عدة متاجر → كل واحد له tenant مستقل
    // ════════════════════════════════════════════════════════════════════

    // 🔍 الخطوة 1: هل هذا المتجر موجود مسبقاً في قاعدة بياناتنا؟
    const existingStore = await this.findStoreBySallaMerchantId(merchantInfo.id);
    if (existingStore?.tenantId) {
      this.logger.log(
        `🔗 Existing store found for merchant ${merchantInfo.id} → reusing tenant ${existingStore.tenantId}`,
      );
      return existingStore.tenantId;
    }

    // 🆕 الخطوة 2: متجر جديد تماماً → إنشاء tenant جديد دائماً
    // ❌ لا نبحث بالإيميل! تاجرين مختلفين بنفس الإيميل = tenants منفصلة
    const tenant = await this.tenantsService.createTenantFromSalla({
      merchantId: merchantInfo.id,
      name: merchantInfo.name || merchantInfo.username || 'متجر سلة',
      email: ownerEmail,
      phone: ownerMobile,
      logo: merchantInfo.avatar,
      website: merchantInfo.domain,
    });

    this.logger.log(`🆕 Created new tenant ${tenant.id} for merchant ${merchantInfo.id} (ownerEmail: ${ownerEmail})`);
    return tenant.id;
  }
}
