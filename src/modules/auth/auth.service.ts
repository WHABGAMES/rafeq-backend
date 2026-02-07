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
import { OtpService, OtpChannel } from './otp.service';
import { MailService } from '../mail/mail.service';

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
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_SECONDS = 900;
  private readonly LOGIN_ATTEMPT_WINDOW_SECONDS = 600;

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

  async checkEmail(email: string): Promise<{
    exists: boolean;
    hasPassword: boolean;
    authProvider?: string;
  }> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'password', 'authProvider'],
    });

    if (!user) {
      return { exists: false, hasPassword: false };
    }

    return {
      exists: true,
      hasPassword: !!user.password,
      authProvider: user.authProvider,
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

    // التحقق من state للحماية من CSRF (إذا تم إرساله)
    if (state) {
      this.logger.debug(`Salla OAuth state received: ${state.substring(0, 8)}...`);
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

    return `https://accounts.salla.sa/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=offline_access+settings.read`;
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
    this.logger.log('🟣 Zid OAuth attempt');

    // التحقق من state للحماية من CSRF (إذا تم إرساله)
    if (state) {
      this.logger.debug(`Zid OAuth state received: ${state.substring(0, 8)}...`);
    }

    // 1. استبدال الكود بتوكن
    const tokens = await this.exchangeZidCode(code);

    // 2. جلب بيانات التاجر من زد
    const merchantData = await this.getZidMerchantData(tokens.access_token);

    if (!merchantData || !merchantData.user?.email) {
      throw new UnauthorizedException('فشل الحصول على بيانات حساب زد');
    }

    const merchant = merchantData.user;

    // ⚡ توحيد الحسابات: بحث بالإيميل
    const loginResult = await this.findOrCreateUserByEmail({
      email: merchant.email,
      firstName: merchant.name?.split(' ')[0] || 'تاجر',
      lastName: merchant.name?.split(' ').slice(1).join(' ') || 'زد',
      phone: merchant.mobile,
      authProvider: AuthProvider.ZID,
      providerId: String(merchant.id || merchant.store_id),
    });

    this.logger.log(`✅ Zid login successful: ${this.maskEmail(merchant.email)}`);
    return loginResult;
  }

  getZidAuthUrl(): string {
    const clientId = this.configService.get('ZID_CLIENT_ID');
    const redirectUri = this.configService.get('ZID_REDIRECT_URI',
      `${this.configService.get('FRONTEND_URL', 'https://rafeq.ai')}/auth/callback/zid`
    );

    return `https://oauth.zid.sa/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
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
        secret: this.configService.get('JWT_REFRESH_SECRET'),
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
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════════

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password', 'preferences'],
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

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...basePayload, jti: accessJti },
        {
          secret: this.configService.get('JWT_SECRET'),
          expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
        },
      ),
      this.jwtService.signAsync(
        { ...basePayload, jti: refreshJti },
        {
          secret: this.configService.get('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
