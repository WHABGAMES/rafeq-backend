/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Service                               ║
 * ║                                                                                ║
 * ║  ✅ v5: Security Fixes                                                         ║
 * ║  🔧 FIX C4: Token Blacklist عند الـ Logout باستخدام Redis                      ║
 * ║  🔧 FIX M3: إخفاء الإيميل في الـ Logs                                         ║
 * ║  🔧 FIX L1: قفل الحساب بعد 5 محاولات فاشلة                                    ║
 * ║  🔧 FIX H4: تحقق من المدخلات في التسجيل                                       ║
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
import Redis from 'ioredis';

import { User, UserStatus, UserRole } from '@database/entities/user.entity';
import { Tenant, TenantStatus, SubscriptionPlan } from '@database/entities/tenant.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  jti: string; // 🔧 FIX C4: JWT ID للـ blacklist
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    avatar?: string;
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
  preferences?: Record<string, any>;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // 🔧 FIX L1: إعدادات قفل الحساب
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_SECONDS = 900; // 15 دقيقة
  private readonly LOGIN_ATTEMPT_WINDOW_SECONDS = 600; // 10 دقائق

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,

    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,

    // 🔧 FIX C4+L1: Redis للـ token blacklist وقفل الحساب
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 FIX M3: إخفاء الإيميل في الـ Logs
  // ═══════════════════════════════════════════════════════════════════════════════
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***@***';
    const masked = local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
    return `${masked}@${domain}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 FIX L1: فحص وتتبع محاولات الدخول الفاشلة
  // ═══════════════════════════════════════════════════════════════════════════════
  private async checkAccountLocked(email: string): Promise<boolean> {
    const key = `login_locked:${email.toLowerCase()}`;
    const locked = await this.redis.get(key);
    return locked === '1';
  }

  private async recordFailedAttempt(email: string): Promise<number> {
    const key = `login_attempts:${email.toLowerCase()}`;
    const attempts = await this.redis.incr(key);

    // تعيين TTL فقط عند أول محاولة
    if (attempts === 1) {
      await this.redis.expire(key, this.LOGIN_ATTEMPT_WINDOW_SECONDS);
    }

    // قفل الحساب بعد تجاوز الحد
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
  // 🔑 LOGIN
  // ═══════════════════════════════════════════════════════════════════════════════

  async login(email: string, password: string): Promise<LoginResult> {
    // 🔧 FIX M3: لا نسجل الإيميل الكامل
    this.logger.log(`Login attempt for: ${this.maskEmail(email)}`);

    // 🔧 FIX L1: فحص قفل الحساب
    const isLocked = await this.checkAccountLocked(email);
    if (isLocked) {
      this.logger.warn(`🔒 Login rejected: Account locked - ${this.maskEmail(email)}`);
      throw new UnauthorizedException(
        'تم قفل الحساب مؤقتاً بسبب محاولات دخول متعددة. حاول مرة أخرى بعد 15 دقيقة'
      );
    }

    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'password', 'firstName', 'lastName', 'role', 'avatar', 'tenantId', 'status'],
    });

    if (!user) {
      // 🔧 FIX M3: لا نكشف أي حقل كان غلط
      // 🔧 FIX L1: نسجل المحاولة الفاشلة
      await this.recordFailedAttempt(email);
      this.logger.warn(`Login failed: ${this.maskEmail(email)}`);
      throw new UnauthorizedException('البريد الإلكتروني أو رمز الدخول غير صحيح');
    }

    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`Login failed: Account inactive - ${this.maskEmail(email)}`);
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      // 🔧 FIX L1: نسجل المحاولة الفاشلة
      const attempts = await this.recordFailedAttempt(email);
      this.logger.warn(`Login failed: ${this.maskEmail(email)} (attempt ${attempts}/${this.MAX_LOGIN_ATTEMPTS})`);
      throw new UnauthorizedException('البريد الإلكتروني أو رمز الدخول غير صحيح');
    }

    // 🔧 FIX L1: مسح المحاولات الفاشلة عند النجاح
    await this.clearLoginAttempts(email);

    const tokens = await this.generateTokens(user);

    await this.userRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

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
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKENS
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      // 🔧 FIX C4: فحص الـ blacklist
      if (payload.jti) {
        const isBlacklisted = await this.isTokenBlacklisted(payload.jti);
        if (isBlacklisted) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'email', 'tenantId', 'role', 'status'],
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('المستخدم غير موجود أو غير مفعّل');
      }

      return this.generateTokens(user);
    } catch (error: any) {
      this.logger.warn(`Token refresh failed: ${error.message}`);
      throw new UnauthorizedException('التوكن غير صالح أو منتهي الصلاحية');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT
  // 🔧 FIX C4: إضافة Token Blacklist باستخدام Redis
  // ═══════════════════════════════════════════════════════════════════════════════

  async logout(userId: string, accessTokenJti?: string, refreshTokenJti?: string): Promise<void> {
    this.logger.log(`User logged out: ${userId}`);

    // 🔧 FIX C4: إضافة التوكنات للـ blacklist
    if (accessTokenJti) {
      // Access token - TTL = remaining lifetime (max 15 minutes)
      await this.blacklistToken(accessTokenJti, 900);
    }

    if (refreshTokenJti) {
      // Refresh token - TTL = remaining lifetime (max 7 days)
      await this.blacklistToken(refreshTokenJti, 604800);
    }
  }

  /**
   * 🔧 FIX C4: إضافة token للـ blacklist في Redis
   */
  private async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
    const key = `token_blacklist:${jti}`;
    await this.redis.set(key, '1', 'EX', ttlSeconds);
  }

  /**
   * 🔧 FIX C4: فحص هل التوكن موجود في الـ blacklist
   * هذه الدالة تُستدعى من JwtStrategy.validate()
   */
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
      select: ['id', 'email', 'firstName', 'lastName', 'phone', 'avatar', 'role', 'tenantId', 'preferences', 'createdAt'],
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
      preferences: user.preferences,
      createdAt: user.createdAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════════

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password', 'preferences'],
    });

    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('رمز الدخول الحالي غير صحيح');
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
  // 📝 REGISTER
  // 🔧 FIX H4: التحقق يتم الآن عبر RegisterDto في الـ Controller
  // ═══════════════════════════════════════════════════════════════════════════════

  async register(input: {
    email: string;
    password: string;
    name: string;
    storeName?: string;
  }): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();

    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('البريد الإلكتروني مسجل مسبقاً');
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
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎟️ GENERATE TOKENS
  // 🔧 FIX C4: إضافة JTI لكل token
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
