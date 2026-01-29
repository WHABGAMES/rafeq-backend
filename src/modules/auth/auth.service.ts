/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Service                               ║
 * ║                                                                                ║
 * ║  📌 Business Logic للتوثيق                                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import { User, UserStatus, UserRole } from '@database/entities/user.entity';
import { Tenant, TenantStatus, SubscriptionPlan } from '@database/entities/tenant.entity';
import { LoginDto, RegisterDto, TokensDto } from './dto';

/**
 * 📌 JWT Payload Interface
 */
export interface JwtPayload {
  sub: string;        // User ID
  email: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,  // للـ transactions
  ) {}

  /**
   * 🔐 تسجيل الدخول
   */
  async login(dto: LoginDto): Promise<TokensDto> {
    // البحث عن المستخدم مع كلمة المرور
    const user = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
      select: ['id', 'email', 'password', 'status', 'tenantId', 'role', 'firstName', 'lastName'],
    });

    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    // التحقق من حالة المستخدم
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    // التحقق من كلمة المرور
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    // إنشاء الـ tokens
    const tokens = await this.generateTokens(user);

    // حفظ الـ refresh token
    await this.userRepository.update(user.id, {
      refreshToken: tokens.refreshToken,
      lastLoginAt: new Date(),
    });

    return tokens;
  }

  /**
   * 🔄 تجديد الـ Token
   */
  async refreshTokens(refreshToken: string): Promise<TokensDto> {
    try {
      // التحقق من الـ refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('jwt.secret'),
      });

      // البحث عن المستخدم
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'email', 'tenantId', 'role', 'refreshToken', 'status'],
      });

      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('الحساب غير مفعّل');
      }

      // إنشاء tokens جديدة
      const tokens = await this.generateTokens(user);

      // تحديث الـ refresh token
      await this.userRepository.update(user.id, {
        refreshToken: tokens.refreshToken,
      });

      return tokens;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * 🚪 تسجيل الخروج
   */
  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      refreshToken: undefined,
    });
  }

  /**
   * 📝 إنشاء حساب جديد
   * 
   * ينشئ:
   * 1. Tenant (المتجر)
   * 2. User (صاحب المتجر)
   * 
   * يستخدم Transaction لضمان إنشاء الاثنين معاً أو لا شيء
   */
  async register(dto: RegisterDto): Promise<TokensDto> {
    // التحقق من عدم وجود البريد مسبقاً
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('البريد الإلكتروني مستخدم مسبقاً');
    }

    // استخدام Transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1️⃣ إنشاء الـ Tenant
      const slug = this.generateSlug(dto.storeName);
      
      const tenant = queryRunner.manager.create(Tenant, {
        name: dto.storeName,
        slug: slug,
        status: TenantStatus.TRIAL,
        subscriptionPlan: SubscriptionPlan.FREE,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 يوم
        settings: {
          ai: {
            enabled: true,
            tone: 'friendly',
            language: 'ar',
            autoHandoff: true,
            handoffAfterFailures: 3,
          },
          privacy: {
            requireVerification: true,
            verificationMethods: ['otp'],
            maskOrderDetails: true,
          },
        },
        timezone: 'Asia/Riyadh',
        defaultLanguage: 'ar',
        currency: 'SAR',
        monthlyMessageLimit: 1000, // الخطة المجانية
      });

      const savedTenant = await queryRunner.manager.save(tenant);

      // 2️⃣ إنشاء المستخدم (صاحب المتجر)
      const hashedPassword = await bcrypt.hash(dto.password, 12);

      const user = queryRunner.manager.create(User, {
        tenantId: savedTenant.id,
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.OWNER,  // صاحب المتجر
        status: UserStatus.ACTIVE,
        emailVerified: false, // سيتم التحقق لاحقاً
      });

      const savedUser = await queryRunner.manager.save(user);

      // 3️⃣ Commit الـ Transaction
      await queryRunner.commitTransaction();

      // 4️⃣ إنشاء الـ Tokens
      const tokens = await this.generateTokens(savedUser);

      // 5️⃣ حفظ الـ Refresh Token
      await this.userRepository.update(savedUser.id, {
        refreshToken: tokens.refreshToken,
      });

      return tokens;
    } catch (error) {
      // Rollback في حالة الخطأ
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // إغلاق الاتصال
      await queryRunner.release();
    }
  }

  /**
   * 🔒 تغيير كلمة المرور
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    // جلب المستخدم مع كلمة المرور
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });

    if (!user) {
      throw new BadRequestException('المستخدم غير موجود');
    }

    // التحقق من كلمة المرور الحالية
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
    }

    // تشفير كلمة المرور الجديدة
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // تحديث كلمة المرور
    await this.userRepository.update(userId, {
      password: hashedPassword,
      refreshToken: undefined, // إبطال كل الـ sessions
    });
  }

  /**
   * 🔗 توليد slug من اسم المتجر
   */
  private generateSlug(name: string): string {
    // تحويل للحروف الصغيرة
    let slug = name.toLowerCase();
    
    // استبدال المسافات بـ -
    slug = slug.replace(/\s+/g, '-');
    
    // إزالة الأحرف الخاصة
    slug = slug.replace(/[^a-z0-9\u0600-\u06FF-]/g, '');
    
    // إضافة رقم عشوائي لضمان الفريدة
    slug = `${slug}-${nanoid(6)}`;
    
    return slug;
  }

  /**
   * 🔑 إنشاء الـ Tokens
   */
  private async generateTokens(user: User): Promise<TokensDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      // Access Token (قصير المدة)
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get('jwt.accessExpiration'),
      }),
      // Refresh Token (طويل المدة)
      this.jwtService.signAsync(payload, {
        expiresIn: this.configService.get('jwt.refreshExpiration'),
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.getExpirationSeconds(
        this.configService.get('jwt.accessExpiration') || '15m',
      ),
    };
  }

  /**
   * تحويل مدة الصلاحية إلى ثواني
   */
  private getExpirationSeconds(expiration: string): number {
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // 15 minutes default

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 900;
    }
  }
}
