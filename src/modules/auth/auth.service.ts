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
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import { User, UserStatus, UserRole } from '@database/entities/user.entity';
import { Tenant, TenantStatus, SubscriptionPlan } from '@database/entities/tenant.entity';
import { LoginDto, RegisterDto, TokensDto, OtpChannelDto, VerificationMethodDto } from './dto';
import { OtpService, OtpChannel } from './otp.service';
import { MailService } from '../mail/mail.service';
import { StoresService } from '../stores/stores.service';
import { WhatsAppOtpService } from './whatsapp-otp.service';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,  // للـ transactions
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly storesService: StoresService,
    private readonly whatsAppOtpService: WhatsAppOtpService,
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
    } catch (error) {
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
        email: dto.email.toLowerCase(),  // ✅ إضافة البريد للـ Tenant
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
    } catch (error: any) {
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 OTP Authentication - للدخول من سلة (متعدد القنوات)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📋 جلب طرق التحقق المتاحة للتاجر
   */
  async getVerificationMethods(merchantId: number): Promise<{
    merchantName: string;
    methods: VerificationMethodDto[];
  }> {
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (!store) {
      throw new NotFoundException('لم يتم العثور على متجر مرتبط بهذا الحساب. يرجى تثبيت التطبيق أولاً.');
    }

    const methods: VerificationMethodDto[] = [];

    // 📧 البريد الإلكتروني
    if (store.sallaEmail) {
      methods.push({
        channel: OtpChannelDto.EMAIL,
        maskedValue: this.maskEmail(store.sallaEmail),
        isAvailable: true,
      });
    }

    // 📱 واتساب
    if (store.sallaMobile) {
      methods.push({
        channel: OtpChannelDto.WHATSAPP,
        maskedValue: this.maskPhone(store.sallaMobile),
        isAvailable: this.whatsAppOtpService.isWhatsAppConfigured(),
      });
    }

    return {
      merchantName: store.sallaStoreName || store.name || 'التاجر',
      methods,
    };
  }

  /**
   * 📧📱 إرسال OTP للتاجر عبر القناة المختارة
   */
  async sendOtpToMerchant(
    merchantId: number,
    channel: OtpChannelDto = OtpChannelDto.EMAIL,
  ): Promise<{
    success: boolean;
    message: string;
    maskedValue: string;
    channel: OtpChannelDto;
    expiresAt: Date;
  }> {
    // 1️⃣ البحث عن المتجر
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (!store) {
      throw new NotFoundException('لم يتم العثور على متجر مرتبط بهذا الحساب. يرجى تثبيت التطبيق أولاً.');
    }

    if (!store.tenantId) {
      throw new BadRequestException('المتجر غير مفعّل. يرجى إعادة تثبيت التطبيق.');
    }

    // 2️⃣ تحديد المُعرّف حسب القناة
    let identifier: string;
    let maskedValue: string;

    if (channel === OtpChannelDto.WHATSAPP) {
      if (!store.sallaMobile) {
        throw new BadRequestException('لم يتم العثور على رقم هاتف للمتجر.');
      }
      if (!this.whatsAppOtpService.isWhatsAppConfigured()) {
        throw new BadRequestException('خدمة WhatsApp غير متاحة حالياً. يرجى استخدام البريد الإلكتروني.');
      }
      identifier = store.sallaMobile;
      maskedValue = this.maskPhone(identifier);
    } else {
      if (!store.sallaEmail) {
        throw new BadRequestException('لم يتم العثور على بريد إلكتروني للمتجر.');
      }
      identifier = store.sallaEmail;
      maskedValue = this.maskEmail(identifier);
    }

    // 3️⃣ توليد OTP
    const otpChannel = channel === OtpChannelDto.WHATSAPP ? OtpChannel.WHATSAPP : OtpChannel.EMAIL;
    const { otp, expiresAt } = await this.otpService.generateOtp(identifier, otpChannel, {
      merchantId,
      tenantId: store.tenantId,
      email: store.sallaEmail,
      phone: store.sallaMobile,
    });

    // 4️⃣ إرسال OTP عبر القناة المختارة
    let sent = false;

    if (channel === OtpChannelDto.WHATSAPP) {
      sent = await this.whatsAppOtpService.sendOtpWhatsApp(
        identifier,
        otp,
        store.sallaStoreName || store.name,
      );
    } else {
      sent = await this.mailService.sendOtpEmail(
        identifier,
        otp,
        store.sallaStoreName || store.name,
      );
    }

    if (!sent) {
      // حذف OTP إذا فشل الإرسال
      await this.otpService.deleteOtp(identifier, otpChannel);
      throw new BadRequestException(`فشل في إرسال رمز التحقق عبر ${channel === OtpChannelDto.WHATSAPP ? 'الواتساب' : 'البريد'}. يرجى المحاولة لاحقاً.`);
    }

    const channelName = channel === OtpChannelDto.WHATSAPP ? 'رقم الواتساب' : 'بريدك الإلكتروني';

    return {
      success: true,
      message: `تم إرسال رمز التحقق إلى ${channelName}`,
      maskedValue,
      channel,
      expiresAt,
    };
  }

  /**
   * ✅ التحقق من OTP وتسجيل الدخول
   * 
   * @param merchantId رقم التاجر في سلة
   * @param otp رمز التحقق
   * @param channel قناة التحقق (email/whatsapp)
   */
  async verifyOtpAndLogin(
    merchantId: number,
    otp: string,
    channel: OtpChannelDto = OtpChannelDto.EMAIL,
  ): Promise<TokensDto & { isFirstLogin: boolean; userId: string; tenantId: string }> {
    // 1️⃣ البحث عن المتجر للحصول على الـ identifier الحقيقي
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (!store) {
      throw new BadRequestException('المتجر غير موجود');
    }

    // 2️⃣ تحديد الـ identifier حسب القناة
    const identifier = channel === OtpChannelDto.WHATSAPP 
      ? store.sallaMobile 
      : store.sallaEmail;

    if (!identifier) {
      throw new BadRequestException(
        channel === OtpChannelDto.WHATSAPP 
          ? 'رقم الهاتف غير متوفر'
          : 'البريد الإلكتروني غير متوفر'
      );
    }

    // 3️⃣ التحقق من OTP
    const otpChannel = channel === OtpChannelDto.WHATSAPP ? OtpChannel.WHATSAPP : OtpChannel.EMAIL;
    const verification = await this.otpService.verifyOtp(identifier, otp, otpChannel);

    if (!verification.valid) {
      throw new UnauthorizedException('رمز التحقق غير صحيح');
    }

    // 4️⃣ البحث عن المستخدم بالبريد
    const email = store.sallaEmail || verification.email;
    
    if (!email) {
      throw new BadRequestException('البريد الإلكتروني غير متوفر للمتجر');
    }

    let user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    let isFirstLogin = false;

    // 5️⃣ إذا لم يكن المستخدم موجوداً، ننشئه
    if (!user) {
      // إنشاء المستخدم
      const tempPassword = nanoid(16);
      const hashedPassword = await bcrypt.hash(tempPassword, 12);

      const nameParts = (store.sallaStoreName || store.name || 'مستخدم رفيق').split(' ');

      user = this.userRepository.create({
        tenantId: store.tenantId,
        email: email.toLowerCase(),
        password: hashedPassword,
        firstName: nameParts[0] || 'مستخدم',
        lastName: nameParts.slice(1).join(' ') || 'رفيق',
        phone: store.sallaMobile,
        avatar: store.sallaAvatar,
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        preferences: {
          source: 'salla',
          createdVia: `otp_${channel}`,
          merchantId: merchantId,
        },
      });

      await this.userRepository.save(user);
      isFirstLogin = true;

      this.logger.log(`👤 New user created via OTP (${channel})`, {
        userId: user.id,
        email: user.email,
        merchantId,
      });
    }

    // 6️⃣ التحقق من حالة المستخدم
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    // 7️⃣ إنشاء Tokens
    const tokens = await this.generateTokens(user);

    // 8️⃣ تحديث آخر تسجيل دخول
    await this.userRepository.update(user.id, {
      refreshToken: tokens.refreshToken,
      lastLoginAt: new Date(),
      emailVerified: true,
    });

    this.logger.log(`✅ User logged in via OTP (${channel})`, {
      userId: user.id,
      isFirstLogin,
    });

    return {
      ...tokens,
      isFirstLogin,
      userId: user.id,
      tenantId: user.tenantId,
    };
  }

  /**
   * 🔄 إعادة إرسال OTP
   */
  async resendOtp(
    identifier: string,
    channel: OtpChannelDto = OtpChannelDto.EMAIL,
    merchantId?: number,
  ): Promise<{
    success: boolean;
    message: string;
    maskedValue: string;
    channel: OtpChannelDto;
    expiresAt: Date;
  }> {
    // جلب tenantId و email/phone إذا كان merchantId متوفر
    let tenantId: string | undefined;
    let email: string | undefined;
    let phone: string | undefined;
    let merchantName: string | undefined;
    
    if (merchantId) {
      const store = await this.storesService.findByMerchantId(merchantId);
      tenantId = store?.tenantId;
      email = store?.sallaEmail;
      phone = store?.sallaMobile;
      merchantName = store?.sallaStoreName || store?.name;
    }

    // توليد OTP جديد
    const otpChannel = channel === OtpChannelDto.WHATSAPP ? OtpChannel.WHATSAPP : OtpChannel.EMAIL;
    const { otp, expiresAt } = await this.otpService.generateOtp(identifier, otpChannel, {
      merchantId,
      tenantId,
      email,
      phone,
    });

    // إرسال OTP
    let sent = false;

    if (channel === OtpChannelDto.WHATSAPP) {
      sent = await this.whatsAppOtpService.sendOtpWhatsApp(identifier, otp, merchantName);
    } else {
      sent = await this.mailService.sendOtpEmail(identifier, otp, merchantName);
    }

    if (!sent) {
      await this.otpService.deleteOtp(identifier, otpChannel);
      throw new BadRequestException('فشل في إرسال رمز التحقق. يرجى المحاولة لاحقاً.');
    }

    const maskedValue = channel === OtpChannelDto.WHATSAPP 
      ? this.maskPhone(identifier)
      : this.maskEmail(identifier);

    return {
      success: true,
      message: 'تم إرسال رمز تحقق جديد',
      maskedValue,
      channel,
      expiresAt,
    };
  }

  /**
   * 🎭 إخفاء البريد الإلكتروني
   */
  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    
    if (!domain) return email;
    
    if (localPart.length <= 2) {
      return `${localPart[0]}***@${domain}`;
    }
    
    const visibleStart = localPart.slice(0, 2);
    const visibleEnd = localPart.slice(-1);
    
    return `${visibleStart}***${visibleEnd}@${domain}`;
  }

  /**
   * 🎭 إخفاء رقم الهاتف
   */
  private maskPhone(phone: string): string {
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (cleanPhone.length < 8) return phone;
    
    const countryCode = cleanPhone.slice(0, 3);
    const lastFour = cleanPhone.slice(-4);
    const middleLength = cleanPhone.length - 7;
    const masked = '*'.repeat(middleLength);
    
    return `${countryCode}${masked}${lastFour}`;
  }
}
