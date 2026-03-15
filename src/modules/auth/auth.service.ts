/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Service                               ║
 * ║                                                                                ║
 * ║  ✅ v7: Multi-Auth + Unified Accounts + Forgot Password                     ║
 * ║  🔑 Email + Password                                                          ║
 * ║  📧 Email OTP (رمز تحقق عبر الإيميل)                                          ║
 * ║  🔵 Google OAuth (ID Token verification)                                      ║
 * ║  🟢 Salla OAuth (Authorization Code)                                          ║
 * ║  🟣 Zid OAuth (Authorization Code)                                            ║
 * ║  🔐 Forgot Password (Reset via signed token + email)                          ║
 * ║                                                                                ║
 * ║  ⚡ قاعدة ذهبية: حساب واحد لكل إيميل                                          ║
 * ║  عند الدخول بأي طريقة → بحث بالإيميل → ربط بالحساب الموجود                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Inject,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import Redis from 'ioredis';

import { User, UserStatus, UserRole, AuthProvider } from '@database/entities/user.entity';
import { Tenant, TenantStatus, SubscriptionPlan } from '@database/entities/tenant.entity';
import { TrustedDevice } from './trusted-device.entity';
import { OtpService, OtpChannel } from './otp.service';
import { MailService } from '../mail/mail.service';
import { ZidOAuthService, ZidTokenResponse, ZidStoreInfo } from '../stores/zid-oauth.service';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  jti: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  isNewUser?: boolean;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    avatar?: string;
    authProvider?: string;
    needsPassword?: boolean;
  };
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  role: string;
  tenantId: string;
  authProvider?: string;
  preferences?: Record<string, any>;
  createdAt: Date;
  subscriptionPlan?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_SECONDS = 900;
  private readonly LOGIN_ATTEMPT_WINDOW_SECONDS = 600;

  /**
   * 🔧 FIX C-04/C-05: Validate ALL critical secrets at startup
   * - Rejects known placeholder/default values
   * - Enforces separate JWT_REFRESH_SECRET in production
   * - Validates STORE_ENCRYPTION_KEY presence
   */
  async onModuleInit(): Promise<void> {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    const appSecret = this.configService.get<string>('APP_SECRET');
    const encryptionKey = this.configService.get<string>('STORE_ENCRYPTION_KEY');

    // ── JWT_SECRET: must exist and must NOT be a placeholder ──
    if (!jwtSecret) {
      throw new Error('🚨 FATAL: JWT_SECRET is not configured! Cannot start.');
    }

    const DANGEROUS_PATTERNS = [
      'change-this', 'change-me', 'change_me', 'your-super-secret',
      'change-in-production', 'CHANGE_ME', 'placeholder', 'example',
      'default', 'secret123', 'password',
    ];
    const isPlaceholder = (val: string) =>
      DANGEROUS_PATTERNS.some((p) => val.toLowerCase().includes(p.toLowerCase()));

    if (isPlaceholder(jwtSecret)) {
      const msg = `🚨 FATAL: JWT_SECRET contains a placeholder value! Generate a real secret.`;
      this.logger.error(msg);
      if (isProduction) {
        throw new Error(msg);
      }
      this.logger.warn('⚠️ Allowing placeholder JWT_SECRET in development ONLY.');
    }

    if (jwtSecret.length < 32) {
      this.logger.warn('⚠️ JWT_SECRET is shorter than 32 characters — use at least 64.');
      if (isProduction) {
        throw new Error('🚨 FATAL: JWT_SECRET must be at least 32 characters in production.');
      }
    }

    // ── JWT_REFRESH_SECRET: must be separate in production ──
    if (!refreshSecret) {
      if (isProduction) {
        throw new Error(
          '🚨 FATAL: JWT_REFRESH_SECRET is required in production. ' +
          'Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"',
        );
      }
      this.logger.warn('⚠️ JWT_REFRESH_SECRET not set — using JWT_SECRET as fallback (DEV ONLY).');
    }

    if (refreshSecret && jwtSecret && refreshSecret === jwtSecret) {
      this.logger.warn('⚠️ JWT_REFRESH_SECRET must be different from JWT_SECRET.');
      if (isProduction) {
        throw new Error('🚨 FATAL: JWT_REFRESH_SECRET must differ from JWT_SECRET in production.');
      }
    }

    // ── APP_SECRET ──
    if (appSecret && isPlaceholder(appSecret) && isProduction) {
      throw new Error('🚨 FATAL: APP_SECRET contains a placeholder value in production!');
    }

    // ── STORE_ENCRYPTION_KEY: required in production (H-03) ──
    if (!encryptionKey && isProduction) {
      throw new Error(
        '🚨 FATAL: STORE_ENCRYPTION_KEY is required in production. ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }

    // ── Validate access token expiration ──
    // ✅ FIX: نقرأ JWT_ACCESS_EXPIRATION أولاً (الاسم الصحيح) ثم JWT_EXPIRES_IN كـ fallback
    const accessExp = this.configService.get('JWT_ACCESS_EXPIRATION')
      || this.configService.get('JWT_EXPIRES_IN', '15m');
    if (accessExp.includes('d') || accessExp.includes('h')) {
      this.logger.warn(`⚠️ Access token expiry (${accessExp}) is too long. Will be capped to 15m for security. Set JWT_ACCESS_EXPIRATION=15m in your .env`);
    }

    this.logger.log('✅ All critical secrets validated successfully.');
  }

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,

    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,

    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,

    private readonly otpService: OtpService,
    private readonly mailService: MailService,

    @Inject(forwardRef(() => ZidOAuthService))
    private readonly zidOAuthService: ZidOAuthService,

    @InjectRepository(TrustedDevice)
    private readonly deviceRepository: Repository<TrustedDevice>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛡️ HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***@***';
    const masked = local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
    return `${masked}@${domain}`;
  }

  private async checkAccountLocked(email: string): Promise<boolean> {
    const key = `login_locked:${email.toLowerCase()}`;
    const locked = await this.redis.get(key);
    return locked === '1';
  }

  private async recordFailedAttempt(email: string): Promise<number> {
    const key = `login_attempts:${email.toLowerCase()}`;
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      await this.redis.expire(key, this.LOGIN_ATTEMPT_WINDOW_SECONDS);
    }
    if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
      const lockKey = `login_locked:${email.toLowerCase()}`;
      await this.redis.set(lockKey, '1', 'EX', this.LOCKOUT_DURATION_SECONDS);
      this.logger.warn(`🔒 Account locked: ${this.maskEmail(email)} after ${attempts} failed attempts`);
    }
    return attempts;
  }

  private async clearLoginAttempts(email: string): Promise<void> {
    const attemptsKey = `login_attempts:${email.toLowerCase()}`;
    const lockKey = `login_locked:${email.toLowerCase()}`;
    await this.redis.del(attemptsKey, lockKey);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧 CHECK EMAIL - هل الإيميل مسجل؟
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔧 FIX H-01: check-email no longer reveals authProvider
   * Only returns exists + hasPassword (needed for UX flow)
   * Does NOT reveal which provider was used (prevents social engineering)
   */
  async checkEmail(email: string): Promise<{
    exists: boolean;
    hasPassword: boolean;
  }> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'password'],
    });

    if (!user) {
      return { exists: false, hasPassword: false };
    }

    return {
      exists: true,
      hasPassword: !!user.password,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 LOGIN - Email + Password
  // ═══════════════════════════════════════════════════════════════════════════════

  async login(email: string, password: string): Promise<LoginResult> {
    this.logger.log(`Login attempt for: ${this.maskEmail(email)}`);

    const isLocked = await this.checkAccountLocked(email);
    if (isLocked) {
      throw new UnauthorizedException('تم قفل الحساب مؤقتاً بسبب محاولات دخول متعددة. حاول مرة أخرى بعد 15 دقيقة');
    }

    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'password', 'firstName', 'lastName', 'role', 'avatar', 'tenantId', 'status', 'authProvider'],
    });

    if (!user) {
      await this.recordFailedAttempt(email);
      throw new UnauthorizedException('البريد الإلكتروني أو رمز الدخول غير صحيح');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    // إذا المستخدم ما عنده باسورد (سجّل عبر OAuth/OTP)
    if (!user.password) {
      throw new UnauthorizedException(
        'هذا الحساب مسجّل عبر ' + this.getProviderName(user.authProvider) +
        '. استخدم نفس الطريقة لتسجيل الدخول أو اختر "نسيت كلمة المرور" لإنشاء كلمة مرور.'
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const attempts = await this.recordFailedAttempt(email);
      const remaining = this.MAX_LOGIN_ATTEMPTS - attempts;
      if (remaining > 0 && remaining <= 2) {
        throw new UnauthorizedException(`رمز الدخول غير صحيح. متبقي ${remaining} محاولة قبل قفل الحساب`);
      }
      throw new UnauthorizedException('البريد الإلكتروني أو رمز الدخول غير صحيح');
    }

    await this.clearLoginAttempts(email);
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });

    const tokens = await this.generateTokens(user);

    this.logger.log(`✅ Login successful: ${this.maskEmail(email)}`);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
        authProvider: user.authProvider,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧 EMAIL OTP - إرسال والتحقق من الرمز
  // ═══════════════════════════════════════════════════════════════════════════════

  async sendEmailOtp(email: string): Promise<{ message: string; expiresAt: Date }> {
    const normalizedEmail = email.toLowerCase().trim();
    this.logger.log(`📧 Sending OTP to: ${this.maskEmail(normalizedEmail)}`);

    // توليد OTP
    const { otp, expiresAt } = await this.otpService.generateOtp(
      normalizedEmail,
      OtpChannel.EMAIL,
      { email: normalizedEmail },
    );

    // إرسال عبر الإيميل
    await this.mailService.sendOtpEmail(normalizedEmail, otp);

    this.logger.log(`✅ OTP sent to: ${this.maskEmail(normalizedEmail)}`);
    return {
      message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني',
      expiresAt,
    };
  }

  async verifyEmailOtp(email: string, otp: string): Promise<LoginResult> {
    const normalizedEmail = email.toLowerCase().trim();
    this.logger.log(`🔍 Verifying OTP for: ${this.maskEmail(normalizedEmail)}`);

    // التحقق من OTP
    const result = await this.otpService.verifyOtp(normalizedEmail, otp, OtpChannel.EMAIL);

    if (!result.valid) {
      throw new UnauthorizedException('رمز التحقق غير صحيح');
    }

    // ⚡ توحيد الحسابات: بحث بالإيميل
    const loginResult = await this.findOrCreateUserByEmail({
      email: normalizedEmail,
      authProvider: AuthProvider.OTP,
    });

    this.logger.log(`✅ OTP verified for: ${this.maskEmail(normalizedEmail)}`);
    return loginResult;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔵 GOOGLE OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  async googleAuth(idToken: string): Promise<LoginResult> {
    this.logger.log('🔵 Google OAuth attempt');

    // التحقق من Google ID Token
    const googleUser = await this.verifyGoogleToken(idToken);

    if (!googleUser || !googleUser.email) {
      throw new UnauthorizedException('فشل التحقق من حساب Google');
    }

    // ⚡ توحيد الحسابات: بحث بالإيميل
    const loginResult = await this.findOrCreateUserByEmail({
      email: googleUser.email,
      firstName: googleUser.given_name || googleUser.name?.split(' ')[0],
      lastName: googleUser.family_name || googleUser.name?.split(' ').slice(1).join(' '),
      avatar: googleUser.picture,
      authProvider: AuthProvider.GOOGLE,
      providerId: googleUser.sub,
    });

    this.logger.log(`✅ Google login successful: ${this.maskEmail(googleUser.email)}`);
    return loginResult;
  }

  private async verifyGoogleToken(idToken: string): Promise<Record<string, string>> {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');

    try {
      // التحقق من التوكن عبر Google API
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
      );

      if (!response.ok) {
        throw new Error('Invalid Google token');
      }

      const payload = await response.json() as Record<string, string>;

      // التحقق من audience
      if (payload.aud !== clientId) {
        throw new Error('Token audience mismatch');
      }

      return payload;
    } catch (error) {
      this.logger.error(`❌ Google token verification failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw new UnauthorizedException('فشل التحقق من حساب Google');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🟢 SALLA OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  async sallaAuth(code: string, state?: string): Promise<LoginResult> {
    this.logger.log('🟢 Salla OAuth attempt');

    // 🔧 FIX H-01: Validate HMAC-signed state parameter to prevent CSRF
    if (state) {
      if (!this.verifyOAuthState(state)) {
        this.logger.error('🚨 Invalid OAuth state parameter — potential CSRF attack');
        throw new UnauthorizedException('Invalid OAuth state parameter');
      }
      this.logger.debug('✅ OAuth state verified successfully');
    } else if (this.configService.get('NODE_ENV') === 'production') {
      // In production, state parameter is REQUIRED
      this.logger.error('🚨 Missing OAuth state parameter in production');
      throw new BadRequestException('OAuth state parameter is required');
    }

    // 1. استبدال الكود بتوكن
    const tokens = await this.exchangeSallaCode(code);

    // 2. جلب بيانات التاجر من سلة
    const merchantData = await this.getSallaMerchantData(tokens.access_token);

    if (!merchantData || !merchantData.data?.email) {
      throw new UnauthorizedException('فشل الحصول على بيانات حساب سلة');
    }

    const merchant = merchantData.data;

    // ⚡ توحيد الحسابات: بحث بالإيميل
    const loginResult = await this.findOrCreateUserByEmail({
      email: merchant.email,
      firstName: merchant.name?.split(' ')[0] || 'تاجر',
      lastName: merchant.name?.split(' ').slice(1).join(' ') || 'سلة',
      avatar: merchant.avatar,
      phone: merchant.mobile,
      authProvider: AuthProvider.SALLA,
      providerId: String(merchant.id || merchant.merchant),
    });

    this.logger.log(`✅ Salla login successful: ${this.maskEmail(merchant.email)}`);
    return loginResult;
  }

  getSallaAuthUrl(): string {
    const clientId = this.configService.get('SALLA_CLIENT_ID');
    const redirectUri = this.configService.get('SALLA_REDIRECT_URI',
      `${this.configService.get('FRONTEND_URL', 'https://rafeq.ai')}/auth/callback/salla`
    );

    // 🔧 FIX H-01: Include HMAC-signed state for CSRF protection
    const state = this.generateOAuthState('login', 'salla');

    return `https://accounts.salla.sa/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=offline_access+settings.read&state=${encodeURIComponent(state)}`;
  }

  private async exchangeSallaCode(code: string): Promise<any> {
    const clientId = this.configService.get('SALLA_CLIENT_ID');
    const clientSecret = this.configService.get('SALLA_CLIENT_SECRET');
    const redirectUri = this.configService.get('SALLA_REDIRECT_URI',
      `${this.configService.get('FRONTEND_URL', 'https://rafeq.ai')}/auth/callback/salla`
    );

    try {
      const response = await fetch('https://accounts.salla.sa/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Salla token exchange failed: ${error}`);
      }

      return response.json();
    } catch (error) {
      this.logger.error(`❌ Salla code exchange failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw new UnauthorizedException('فشل الاتصال بحساب سلة');
    }
  }

  private async getSallaMerchantData(accessToken: string): Promise<any> {
    try {
      const response = await fetch('https://api.salla.dev/admin/v2/oauth2/user/info', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error('Failed to get Salla merchant data');
      }

      return response.json();
    } catch (error) {
      this.logger.error(`❌ Failed to get Salla merchant data: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw new UnauthorizedException('فشل الحصول على بيانات حساب سلة');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🟣 ZID OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  async zidAuth(code: string, state?: string): Promise<LoginResult> {
    this.logger.log('🟣 Zid OAuth activation attempt');

    // 🔧 FIX H-01: Validate HMAC-signed state parameter to prevent CSRF
    if (state) {
      if (!this.verifyOAuthState(state)) {
        this.logger.error('🚨 Invalid OAuth state parameter — potential CSRF attack');
        throw new UnauthorizedException('Invalid OAuth state parameter');
      }
      this.logger.debug('✅ OAuth state verified successfully');
    } else if (this.configService.get('NODE_ENV') === 'production') {
      this.logger.error('🚨 Missing OAuth state parameter in production');
      throw new BadRequestException('OAuth state parameter is required');
    }

    // 1. استبدال الكود بتوكن
    const rawTokens = await this.exchangeZidCode(code);
    const tokens: ZidTokenResponse = {
      access_token: rawTokens.access_token,
      refresh_token: rawTokens.refresh_token,
      expires_in: rawTokens.expires_in ?? 3600,
      token_type: rawTokens.token_type ?? 'Bearer',
      authorization: rawTokens.authorization,
    };

    // 2. جلب بيانات المتجر عبر ZidOAuthService (يدعم عدة endpoints وترويسات)
    let storeInfo: ZidStoreInfo | null = null;
    try {
      storeInfo = await this.zidOAuthService.getStoreInfo(
        tokens.access_token,
        tokens.authorization,
      );
      if (storeInfo) {
        this.logger.log(`📊 Zid store info: id=${storeInfo.id}, name=${storeInfo.name}`);
      }
    } catch (infoError: any) {
      this.logger.warn(`⚠️ Could not fetch Zid store info via ZidOAuthService: ${infoError.message} — falling back to /account`);
    }

    // 2b. Fallback: جلب البيانات من /account إذا فشل getStoreInfo
    let email: string;
    let merchantName: string;
    let merchantMobile: string | undefined;
    let providerId: string | undefined;

    if (storeInfo?.email && storeInfo.email.includes('@') && !storeInfo.email.endsWith('@store.rafeq.ai')) {
      email = storeInfo.email;
      merchantName = storeInfo.name || 'تاجر زد';
      merchantMobile = storeInfo.mobile;
      providerId = String(storeInfo.id);
    } else {
      const merchantData = await this.getZidMerchantData(tokens.access_token);

      if (!merchantData?.user?.email) {
        throw new UnauthorizedException('فشل الحصول على بيانات حساب زد');
      }

      const merchant = merchantData.user;
      email = merchant.email;
      merchantName = merchant.name || 'تاجر زد';
      merchantMobile = merchant.mobile;
      providerId = String(merchant.id || merchant.store_id);

      // تحديث storeInfo بالإيميل الصحيح إذا كان مولّداً
      if (storeInfo) {
        storeInfo.email = email;
      }
    }

    // 3. إيجاد أو إنشاء المستخدم
    const loginResult = await this.findOrCreateUserByEmail({
      email,
      firstName: merchantName.split(' ')[0] || 'تاجر',
      lastName: merchantName.split(' ').slice(1).join(' ') || 'زد',
      phone: merchantMobile,
      authProvider: AuthProvider.ZID,
      providerId,
    });

    // ✅ FIX: إرسال بيانات الدخول للمستخدمين الجدد عبر زد (/auth/callback/zid flow)
    if (loginResult.isNewUser) {
      try {
        // توليد كلمة مرور من رقم الجوال
        let password: string;
        if (merchantMobile && typeof merchantMobile === 'string') {
          let cleanMobile = merchantMobile.replace(/\D/g, '');
          if (cleanMobile.startsWith('966') && cleanMobile.length > 9) cleanMobile = cleanMobile.slice(3);
          if (cleanMobile.startsWith('0') && cleanMobile.length > 9) cleanMobile = cleanMobile.slice(1);
          password = cleanMobile.length >= 6 ? `Ra${cleanMobile}` : `Ra${Date.now().toString().slice(-8)}`;
        } else {
          password = `Ra${Date.now().toString().slice(-8)}`;
        }

        // تحديث كلمة المرور في قاعدة البيانات (bcrypt مستورد في أعلى الملف)
        const hashedPassword = await bcrypt.hash(password, 12);
        await this.userRepository.update(loginResult.user.id, { password: hashedPassword });

        // ✅ FIX: تحديث needsPassword لأننا قمنا بتعيين كلمة مرور للمستخدم الجديد
        (loginResult.user as any).needsPassword = false;

        // إرسال بيانات الدخول بالإيميل
        await this.mailService.sendWelcomeCredentials({
          to: email,
          name: merchantName || 'شريكنا',
          storeName: storeInfo?.name || 'متجرك في زد',
          email,
          password,
          loginUrl: 'https://rafeq.ai',
          isNewUser: true,
        });

        this.logger.log(`✅ Welcome credentials sent to new Zid user: ${this.maskEmail(email)}`);
      } catch (welcomeError: any) {
        // non-fatal — لا نُفشل العملية إذا فشل الإرسال
        this.logger.error(`❌ Failed to send welcome credentials for Zid user: ${welcomeError.message}`);
      }
    }

    // 4. ربط متجر زد بالتنانت (non-fatal — لا نفشل العملية إذا تعذّر)
    if (storeInfo) {
      try {
        const user = await this.userRepository.findOne({
          where: { id: loginResult.user.id },
          select: ['id', 'tenantId'],
        });

        if (user?.tenantId) {
          await this.zidOAuthService.connectZidStoreFromTokens(tokens, storeInfo, user.tenantId);
          this.logger.log(`✅ Zid store connected for tenant ${user.tenantId}`);
        } else {
          this.logger.warn('⚠️ User has no tenantId — skipping Zid store connection');
        }
      } catch (storeError: any) {
        this.logger.error(`❌ Zid store connection failed (non-fatal): ${storeError.message}`);
      }
    }

    this.logger.log(`✅ Zid auth successful: ${this.maskEmail(email)}`);
    return loginResult;
  }

  getZidAuthUrl(): string {
    const clientId = this.configService.get('ZID_CLIENT_ID');
    const redirectUri = this.configService.get('ZID_REDIRECT_URI',
      `${this.configService.get('FRONTEND_URL', 'https://rafeq.ai')}/auth/callback/zid`
    );

    // 🔧 FIX H-01: Include HMAC-signed state for CSRF protection
    const state = this.generateOAuthState('login', 'zid');

    return `https://oauth.zid.sa/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
  }

  private async exchangeZidCode(code: string): Promise<any> {
    const clientId = this.configService.get('ZID_CLIENT_ID');
    const clientSecret = this.configService.get('ZID_CLIENT_SECRET');
    const redirectUri = this.configService.get('ZID_REDIRECT_URI',
      `${this.configService.get('FRONTEND_URL', 'https://rafeq.ai')}/auth/callback/zid`
    );

    try {
      const response = await fetch('https://oauth.zid.sa/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        throw new Error('Zid token exchange failed');
      }

      return response.json();
    } catch (error) {
      this.logger.error(`❌ Zid code exchange failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw new UnauthorizedException('فشل الاتصال بحساب زد');
    }
  }

  private async getZidMerchantData(accessToken: string): Promise<any> {
    try {
      const response = await fetch('https://api.zid.sa/v1/account', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error('Failed to get Zid merchant data');
      }

      return response.json();
    } catch (error) {
      this.logger.error(`❌ Failed to get Zid merchant data: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw new UnauthorizedException('فشل الحصول على بيانات حساب زد');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ⚡ UNIFIED ACCOUNT LOGIC - القاعدة الذهبية
  // حساب واحد لكل إيميل بغض النظر عن طريقة الدخول
  // ═══════════════════════════════════════════════════════════════════════════════

  private async findOrCreateUserByEmail(data: {
    email: string;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    phone?: string;
    authProvider: AuthProvider;
    providerId?: string;
  }): Promise<LoginResult> {
    const email = data.email.toLowerCase().trim();

    // 1. بحث عن مستخدم بنفس الإيميل
    let user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'password', 'firstName', 'lastName', 'role', 'avatar', 'phone', 'tenantId', 'status', 'authProvider', 'providerId'],
    });

    let isNewUser = false;

    if (user) {
      // ════════════════════════════════════════════════════════════════
      // ✅ مستخدم موجود - تحديث بيانات المزود فقط إذا لزم
      // ════════════════════════════════════════════════════════════════
      this.logger.log(`👤 Existing user found for: ${this.maskEmail(email)} (provider: ${user.authProvider})`);

      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('الحساب غير مفعّل');
      }

      // تحديث providerId إذا كان فارغاً والطريقة الجديدة تحتوي على واحد
      const updates: {
        lastLoginAt: Date;
        providerId?: string;
        avatar?: string;
        phone?: string;
      } = { lastLoginAt: new Date() };

      if (data.providerId && !user.providerId) {
        updates.providerId = data.providerId;
      }
      // تحديث الصورة إذا كانت فارغة
      if (data.avatar && !user.avatar) {
        updates.avatar = data.avatar;
      }
      // تحديث الهاتف إذا كان فارغاً
      if (data.phone && !user.phone) {
        updates.phone = data.phone;
      }

      await this.userRepository.update(user.id, updates);

    } else {
      // ════════════════════════════════════════════════════════════════
      // 🆕 مستخدم جديد - إنشاء حساب + tenant
      // ════════════════════════════════════════════════════════════════
      this.logger.log(`🆕 Creating new user for: ${this.maskEmail(email)} via ${data.authProvider}`);

      const tenant = this.tenantRepository.create({
        name: data.firstName ? `${data.firstName} ${data.lastName || ''}`.trim() : 'مستخدم جديد',
        email,
        slug: `user-${Date.now()}`,
        status: TenantStatus.ACTIVE,
        subscriptionPlan: SubscriptionPlan.FREE,
      });
      const savedTenant = await this.tenantRepository.save(tenant);

      user = this.userRepository.create({
        tenantId: savedTenant.id,
        email,
        firstName: data.firstName || 'مستخدم',
        lastName: data.lastName || 'رفيق',
        avatar: data.avatar,
        phone: data.phone,
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        authProvider: data.authProvider,
        providerId: data.providerId,
      });

      user = await this.userRepository.save(user);
      isNewUser = true;

      this.logger.log(`✅ New user created: ${user.id}`);
    }

    // توليد التوكنات
    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      isNewUser,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
        authProvider: user.authProvider,
        needsPassword: !user.password,
      },
    };
  }

  private getProviderName(provider?: AuthProvider): string {
    const names: Record<string, string> = {
      [AuthProvider.LOCAL]: 'الإيميل وكلمة المرور',
      [AuthProvider.GOOGLE]: 'Google',
      [AuthProvider.SALLA]: 'سلة',
      [AuthProvider.ZID]: 'زد',
      [AuthProvider.OTP]: 'رمز التحقق',
    };
    return provider ? names[provider] || provider : 'طريقة أخرى';
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKENS
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET')
          || this.configService.get('JWT_SECRET'),
      });

      if (payload.jti) {
        const isBlacklisted = await this.isTokenBlacklisted(payload.jti);
        if (isBlacklisted) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'email', 'tenantId', 'role', 'status', 'preferences'],
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('المستخدم غير موجود أو غير مفعّل');
      }

      // ✅ رفض التوكن إذا تم تغيير كلمة المرور بعد إصداره
      if (user.preferences?.passwordResetAt && payload.iat) {
        const resetTime = new Date(user.preferences.passwordResetAt as string).getTime() / 1000;
        if (payload.iat < resetTime) {
          throw new UnauthorizedException('تم تغيير كلمة المرور. يرجى تسجيل الدخول مجدداً.');
        }
      }

      return this.generateTokens(user);
    } catch (error: any) {
      // ✅ إعادة رمي الخطأ إذا كان UnauthorizedException (مثل: تم تغيير كلمة المرور)
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('التوكن غير صالح أو منتهي الصلاحية');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT
  // ═══════════════════════════════════════════════════════════════════════════════

  async logout(userId: string, accessTokenJti?: string, refreshTokenJti?: string): Promise<void> {
    this.logger.log(`User logged out: ${userId}`);
    if (accessTokenJti) await this.blacklistToken(accessTokenJti, 900);
    if (refreshTokenJti) await this.blacklistToken(refreshTokenJti, 604800);
  }

  private async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    const key = `token_blacklist:${jti}`;
    await this.redis.set(key, '1', 'EX', ttlSeconds);
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `token_blacklist:${jti}`;
    const result = await this.redis.get(key);
    return result === '1';
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 GET USER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════════

  async getUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName', 'lastName', 'phone', 'avatar', 'role', 'tenantId', 'authProvider', 'preferences', 'createdAt'],
    });

    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    // Get subscription plan from tenant
    let subscriptionPlan = 'free';
    try {
      const tenant = await this.tenantRepository.findOne({ where: { id: user.tenantId }, select: ['subscriptionPlan'] });
      if (tenant) subscriptionPlan = tenant.subscriptionPlan || 'free';
    } catch {}

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      tenantId: user.tenantId,
      authProvider: user.authProvider,
      preferences: user.preferences,
      createdAt: user.createdAt,
      subscriptionPlan,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════════

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName', 'password', 'preferences'],
    });

    if (!user) throw new UnauthorizedException('المستخدم غير موجود');

    if (user.password) {
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        throw new BadRequestException('رمز الدخول الحالي غير صحيح');
      }
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('رمز الدخول الجديد يجب أن يكون 8 أحرف على الأقل');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.userRepository.update(userId, {
      password: hashedPassword,
      preferences: {
        ...(user.preferences || {}),
        hasSetPassword: true,
        passwordChangedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`✅ Password changed for user: ${userId}`);

    // ✅ إرسال إيميل تنبيه بتغيير كلمة المرور
    if (user.email) {
      try {
        const now = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'long', timeStyle: 'short' });
        await this.mailService.sendMail({
          to: user.email,
          subject: '🔐 تم تغيير كلمة المرور — رفيق',
          html: `
            <div dir="rtl" style="font-family:system-ui,Arial;max-width:500px;margin:0 auto;padding:30px;background:#0f172a;color:#e2e8f0;border-radius:16px;">
              <div style="text-align:center;margin-bottom:24px;">
                <img src="https://rafeq.ai/images/rafeq-logo.png" alt="رفيق" style="height:40px;" />
              </div>
              <h2 style="color:#fff;font-size:20px;margin:0 0 12px;text-align:center;">تم تغيير كلمة المرور ✅</h2>
              <p style="color:#94a3b8;font-size:14px;line-height:1.8;text-align:center;">
                مرحباً ${user.firstName || ''},<br/>
                تم تغيير كلمة مرور حسابك بنجاح في <strong>${now}</strong>.
              </p>
              <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
                <p style="color:#f59e0b;font-size:13px;margin:0;">⚠️ إذا لم تقم بهذا التغيير، يرجى التواصل مع الدعم فوراً.</p>
              </div>
              <p style="color:#64748b;font-size:12px;text-align:center;margin-top:20px;">هذا إشعار تلقائي من منصة رفيق</p>
            </div>
          `,
        });
      } catch (e: any) {
        this.logger.warn(`⚠️ Failed to send password change alert to ${user.email}: ${e.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 SET PASSWORD (للمستخدمين بدون باسورد)
  // ═══════════════════════════════════════════════════════════════════════════════

  async setPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password', 'preferences'],
    });

    if (!user) throw new UnauthorizedException('المستخدم غير موجود');

    if (user.password) {
      throw new BadRequestException('كلمة المرور موجودة بالفعل. استخدم "تغيير كلمة المرور" بدلاً من ذلك.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.userRepository.update(userId, {
      password: hashedPassword,
      authProvider: AuthProvider.LOCAL,
      preferences: {
        ...(user.preferences || {}),
        hasSetPassword: true,
        passwordSetAt: new Date().toISOString(),
      },
    });

    this.logger.log(`✅ Password set for user: ${userId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 REGISTER
  // ═══════════════════════════════════════════════════════════════════════════════

  async register(input: {
    email: string;
    password: string;
    name: string;
    storeName?: string;
  }): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();

    const existing = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'authProvider'],
    });
    if (existing) {
      const providerName = this.getProviderName(existing.authProvider);
      throw new ConflictException(
        `البريد الإلكتروني مسجل مسبقاً عبر ${providerName}. سجّل دخول بنفس الطريقة أو استخدم طريقة أخرى.`
      );
    }

    const tenant = this.tenantRepository.create({
      name: input.storeName || input.name,
      email,
      slug: `user-${Date.now()}`,
      status: TenantStatus.ACTIVE,
      subscriptionPlan: SubscriptionPlan.FREE,
    });
    const savedTenant = await this.tenantRepository.save(tenant);

    const hashedPassword = await bcrypt.hash(input.password, 12);
    const nameParts = input.name.split(' ');

    const user = this.userRepository.create({
      tenantId: savedTenant.id,
      email,
      password: hashedPassword,
      firstName: nameParts[0] || 'مستخدم',
      lastName: nameParts.slice(1).join(' ') || 'رفيق',
      role: UserRole.OWNER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      authProvider: AuthProvider.LOCAL,
    });
    const savedUser = await this.userRepository.save(user);

    const tokens = await this.generateTokens(savedUser);

    return {
      ...tokens,
      user: {
        id: savedUser.id,
        email: savedUser.email,
        firstName: savedUser.firstName,
        lastName: savedUser.lastName,
        role: savedUser.role,
        avatar: savedUser.avatar,
        authProvider: AuthProvider.LOCAL,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 FORGOT PASSWORD - إرسال رابط استعادة كلمة المرور
  // ═══════════════════════════════════════════════════════════════════════════════

  private readonly RESET_TOKEN_EXPIRY_SECONDS = 30 * 60; // 30 دقيقة
  private readonly RESET_TOKEN_PREFIX = 'password_reset:';
  private readonly RESET_RATE_LIMIT_PREFIX = 'reset_rate:';
  private readonly MAX_RESET_PER_HOUR = 3;

  async forgotPassword(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    this.logger.log(`🔐 Password reset requested for: ${this.maskEmail(normalizedEmail)}`);

    // ✅ Rate limiting - حد أقصى 3 طلبات في الساعة
    const rateLimitKey = `${this.RESET_RATE_LIMIT_PREFIX}${normalizedEmail}`;
    const rateCount = await this.redis.get(rateLimitKey);
    if (rateCount && parseInt(rateCount, 10) >= this.MAX_RESET_PER_HOUR) {
      this.logger.warn(`Rate limit exceeded for password reset: ${this.maskEmail(normalizedEmail)}`);
      // ❗ نرجع نفس الرسالة (لا نكشف أن الإيميل موجود أو لا)
      return { message: 'إذا كان البريد الإلكتروني مسجلاً، سيتم إرسال رابط استعادة كلمة المرور' };
    }

    // ✅ البحث عن المستخدم
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
      select: ['id', 'email', 'firstName', 'lastName', 'status'],
    });

    // ❗ رسالة موحدة سواء الإيميل موجود أو لا (حماية من تعداد الحسابات)
    const successMessage = 'إذا كان البريد الإلكتروني مسجلاً، سيتم إرسال رابط استعادة كلمة المرور';

    if (!user) {
      this.logger.debug(`No user found for: ${this.maskEmail(normalizedEmail)}`);
      return { message: successMessage };
    }

    if (user.status !== UserStatus.ACTIVE) {
      this.logger.debug(`Inactive user attempted password reset: ${user.id}`);
      return { message: successMessage };
    }

    // ✅ حذف أي توكن سابق لنفس المستخدم
    const existingTokenKey = `${this.RESET_TOKEN_PREFIX}user:${user.id}`;
    const existingToken = await this.redis.get(existingTokenKey);
    if (existingToken) {
      await this.redis.del(`${this.RESET_TOKEN_PREFIX}${existingToken}`);
      await this.redis.del(existingTokenKey);
    }

    // ✅ توليد توكن آمن (64 bytes → 128 hex chars)
    const resetToken = crypto.randomBytes(64).toString('hex');
    const resetTokenHash = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(resetToken)
      .digest('hex');

    // ✅ تخزين في Redis مع صلاحية 30 دقيقة
    const tokenData = JSON.stringify({
      userId: user.id,
      email: normalizedEmail,
      createdAt: Date.now(),
    });

    await this.redis.setex(
      `${this.RESET_TOKEN_PREFIX}${resetTokenHash}`,
      this.RESET_TOKEN_EXPIRY_SECONDS,
      tokenData,
    );

    // ربط المستخدم بالتوكن (لحذف القديم عند طلب جديد)
    await this.redis.setex(
      existingTokenKey,
      this.RESET_TOKEN_EXPIRY_SECONDS,
      resetTokenHash,
    );

    // ✅ Increment rate limit
    const rateExists = await this.redis.exists(rateLimitKey);
    if (rateExists) {
      await this.redis.incr(rateLimitKey);
    } else {
      await this.redis.setex(rateLimitKey, 3600, '1');
    }

    // ✅ بناء رابط إعادة التعيين
    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://rafeq.ai');
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(normalizedEmail)}`;

    // ✅ إرسال الإيميل
    try {
      await this.mailService.sendPasswordResetEmail(
        normalizedEmail,
        user.firstName || 'عزيزي التاجر',
        resetUrl,
      );
      this.logger.log(`✅ Password reset email sent to: ${this.maskEmail(normalizedEmail)}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send reset email: ${error instanceof Error ? error.message : 'Unknown'}`);
      // لا نكشف للمستخدم أن الإرسال فشل
    }

    return { message: successMessage };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔍 VERIFY RESET TOKEN - التحقق من صلاحية الرابط
  // ═══════════════════════════════════════════════════════════════════════════════

  async verifyResetToken(token: string, email: string): Promise<{ valid: boolean }> {
    const normalizedEmail = email.toLowerCase().trim();

    const tokenHash = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(token)
      .digest('hex');

    const tokenData = await this.redis.get(`${this.RESET_TOKEN_PREFIX}${tokenHash}`);

    if (!tokenData) {
      this.logger.debug(`Reset token not found or expired for: ${this.maskEmail(normalizedEmail)}`);
      return { valid: false };
    }

    try {
      const parsed = JSON.parse(tokenData);
      if (parsed.email !== normalizedEmail) {
        this.logger.warn(`Reset token email mismatch: expected ${this.maskEmail(normalizedEmail)}`);
        return { valid: false };
      }
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 RESET PASSWORD - تحديث كلمة المرور عبر الرابط
  // ═══════════════════════════════════════════════════════════════════════════════

  async resetPassword(token: string, email: string, newPassword: string): Promise<{ message: string }> {
    const normalizedEmail = email.toLowerCase().trim();
    this.logger.log(`🔄 Password reset attempt for: ${this.maskEmail(normalizedEmail)}`);

    // ✅ التحقق من قوة كلمة المرور
    if (newPassword.length < 8) {
      throw new BadRequestException('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      throw new BadRequestException('كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم');
    }

    // ✅ التحقق من التوكن
    const tokenHash = crypto
      .createHmac('sha256', this.configService.get('JWT_SECRET', 'rafiq-secret'))
      .update(token)
      .digest('hex');

    const tokenKey = `${this.RESET_TOKEN_PREFIX}${tokenHash}`;
    const tokenData = await this.redis.get(tokenKey);

    if (!tokenData) {
      throw new BadRequestException('رابط استعادة كلمة المرور غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد.');
    }

    let parsed: { userId: string; email: string; createdAt: number };
    try {
      parsed = JSON.parse(tokenData);
    } catch {
      throw new BadRequestException('رابط غير صالح');
    }

    // ✅ التأكد من تطابق الإيميل
    if (parsed.email !== normalizedEmail) {
      throw new BadRequestException('رابط غير صالح');
    }

    // ✅ البحث عن المستخدم (مع preferences للدمج)
    const user = await this.userRepository.findOne({
      where: { id: parsed.userId },
      select: ['id', 'email', 'firstName', 'lastName', 'status', 'password', 'preferences'],
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('الحساب غير موجود أو غير مفعّل');
    }

    // ✅ التأكد أن كلمة المرور الجديدة ليست نفس القديمة
    if (user.password) {
      const isSamePassword = await bcrypt.compare(newPassword, user.password);
      if (isSamePassword) {
        throw new BadRequestException('كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية');
      }
    }

    // ✅ تشفير وحفظ كلمة المرور الجديدة (مع دمج التفضيلات القديمة)
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.userRepository.update(user.id, {
      password: hashedPassword,
      authProvider: AuthProvider.LOCAL,
      preferences: {
        ...(user.preferences || {}),
        hasSetPassword: true,
        passwordResetAt: new Date().toISOString(),
      },
    });

    // ✅ حذف التوكن (استخدام مرة واحدة فقط)
    await this.redis.del(tokenKey);
    await this.redis.del(`${this.RESET_TOKEN_PREFIX}user:${user.id}`);

    // ✅ إلغاء الجلسات القديمة:
    // - Access Token قصير (15 دقيقة) → ينتهي تلقائياً
    // - Refresh Token: يُرفض في refreshTokens() لأن preferences.passwordResetAt
    //   أحدث من iat (وقت إصدار التوكن القديم)

    // ✅ مسح محاولات الدخول الفاشلة
    await this.clearLoginAttempts(normalizedEmail);

    // ✅ إرسال إشعار أمني بتغيير كلمة المرور
    try {
      const changeDate = new Date();
      await this.mailService.sendPasswordChangedNotification(
        normalizedEmail,
        user.firstName || 'عزيزي التاجر',
        changeDate,
      );
      this.logger.log(`✅ Password changed notification sent to: ${this.maskEmail(normalizedEmail)}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send password changed notification: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    this.logger.log(`✅ Password reset successful for user: ${user.id}`);
    return { message: 'تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎟️ GENERATE TOKENS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔧 FIX C-02: Access token max 30m, default 15m
   * 🔧 FIX C-03: Refresh secret validated at startup via onModuleInit
   */
  private async generateTokens(user: Pick<User, 'id' | 'email' | 'tenantId' | 'role'>): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessJti = uuidv4();
    const refreshJti = uuidv4();

    const basePayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    // ✅ FIX: نقرأ JWT_ACCESS_EXPIRATION أولاً (الاسم الصحيح) ثم JWT_EXPIRES_IN كـ fallback
    const requestedAccessExp = this.configService.get('JWT_ACCESS_EXPIRATION')
      || this.configService.get('JWT_EXPIRES_IN', '15m');
    const accessExpiresIn = this.sanitizeAccessTokenExpiry(requestedAccessExp);

    // 🔧 FIX C-03: Use separate refresh secret if available, otherwise fallback to JWT_SECRET
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET')
      || this.configService.get<string>('JWT_SECRET');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...basePayload, jti: accessJti, type: 'access' },
        {
          secret: this.configService.get('JWT_SECRET'),
          expiresIn: accessExpiresIn,
        },
      ),
      this.jwtService.signAsync(
        { ...basePayload, jti: refreshJti, type: 'refresh' },
        {
          secret: refreshSecret,
          expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  /**
   * 🔧 FIX C-02: Sanitize access token expiration
   * Converts the env value and caps it at 30 minutes maximum
   */
  private sanitizeAccessTokenExpiry(value: string): string {
    const match = value.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return '15m'; // Invalid format → default

    const num = parseInt(match[1], 10);
    const unit = match[2];

    // Convert to seconds for comparison
    const secondsMap: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    const totalSeconds = num * (secondsMap[unit] || 60);

    // Cap at 30 minutes (1800 seconds)
    const MAX_ACCESS_TOKEN_SECONDS = 1800;
    if (totalSeconds > MAX_ACCESS_TOKEN_SECONDS) {
      this.logger.warn(
        `⚠️ JWT_EXPIRES_IN=${value} exceeds max 30m. Capping to 15m for security.`,
      );
      return '15m';
    }

    return value;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 FIX H-01: HMAC-Signed OAuth State (CSRF Protection)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Generate a CSRF-safe OAuth state parameter
   * Format: base64(JSON({tenantId, ts, nonce})) + '.' + HMAC-SHA256(payload)
   */
  generateOAuthState(tenantId: string, custom?: string): string {
    const payload = JSON.stringify({
      tenantId,
      custom: custom || '',
      ts: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    });

    const encoded = Buffer.from(payload).toString('base64url');
    const secret = this.configService.get('JWT_SECRET', '');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encoded)
      .digest('hex');

    return `${encoded}.${signature}`;
  }

  /**
   * Verify HMAC-signed OAuth state parameter
   * Returns true if signature is valid and not expired (10 min window)
   */
  private verifyOAuthState(state: string): boolean {
    try {
      const [encoded, signature] = state.split('.');
      if (!encoded || !signature) return false;

      // Verify HMAC signature
      const secret = this.configService.get('JWT_SECRET', '');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(encoded)
        .digest('hex');

      if (!crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      )) {
        return false;
      }

      // Verify timestamp (10 minute expiry)
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      const MAX_STATE_AGE_MS = 10 * 60 * 1000; // 10 minutes
      if (Date.now() - payload.ts > MAX_STATE_AGE_MS) {
        this.logger.warn('OAuth state expired');
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('OAuth state verification failed', error);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 TRUSTED DEVICES
  // ═══════════════════════════════════════════════════════════════════════════════

  async trackDevice(userId: string, tenantId: string, req: { ip?: string; userAgent?: string }): Promise<void> {
    try {
      // Always lookup tenantId from user to be reliable
      const user = await this.userRepository.findOne({ where: { id: userId } });
      const tid = user?.tenantId || tenantId || '';

      const ua = req.userAgent || '';
      const ip = req.ip || 'unknown';
      const parsed = this.parseUA(ua);

      // Check if same device (same IP + browser + OS)
      const existing = await this.deviceRepository.findOne({
        where: { userId, ipAddress: ip, browser: parsed.browser, os: parsed.os, isActive: true },
      });

      if (existing) {
        existing.lastActiveAt = new Date();
        existing.userAgent = ua;
        await this.deviceRepository.save(existing);
        this.logger.log(`📱 Device updated: ${parsed.browser}/${parsed.os} for user ${userId}`);
      } else {
        await this.deviceRepository.save({
          userId,
          tenantId: tid || undefined,
          deviceName: `${parsed.deviceType} • ${parsed.os}`,
          browser: parsed.browser,
          os: parsed.os,
          ipAddress: ip,
          userAgent: ua,
          lastActiveAt: new Date(),
        });
        this.logger.log(`📱 New device: ${parsed.browser}/${parsed.os} IP:${ip} user:${userId}`);
      }
    } catch (err) {
      this.logger.error(`Failed to track device: ${(err as Error).message}`);
    }
  }

  async getDevices(userId: string): Promise<TrustedDevice[]> {
    return this.deviceRepository.find({
      where: { userId, isActive: true },
      order: { lastActiveAt: 'DESC' },
    });
  }

  async revokeDevice(userId: string, deviceId: string): Promise<boolean> {
    const device = await this.deviceRepository.findOne({ where: { id: deviceId, userId } });
    if (!device) return false;
    device.isActive = false;
    await this.deviceRepository.save(device);
    return true;
  }

  async revokeAllDevices(userId: string, exceptDeviceIp?: string): Promise<number> {
    const devices = await this.deviceRepository.find({ where: { userId, isActive: true } });
    let count = 0;
    for (const d of devices) {
      if (exceptDeviceIp && d.ipAddress === exceptDeviceIp) continue;
      d.isActive = false;
      await this.deviceRepository.save(d);
      count++;
    }
    return count;
  }

  private parseUA(ua: string): { deviceType: string; browser: string; os: string } {
    const lower = ua.toLowerCase();
    let deviceType = 'كمبيوتر';
    if (/mobile|android|iphone|ipod/.test(lower)) deviceType = 'جوال';
    else if (/tablet|ipad/.test(lower)) deviceType = 'تابلت';

    let browser = 'متصفح';
    if (/edg/i.test(ua)) browser = 'Edge';
    else if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome';
    else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
    else if (/opera|opr/i.test(ua)) browser = 'Opera';

    let os = 'نظام';
    if (/windows/i.test(ua)) os = 'Windows';
    else if (/mac os|macintosh/i.test(ua)) os = 'macOS';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
    else if (/linux/i.test(ua)) os = 'Linux';

    return { deviceType, browser, os };
  }

}
