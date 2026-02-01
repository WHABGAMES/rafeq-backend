/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Service                               ║
 * ║                                                                                ║
 * ║  ✅ Email + Password Login                                                      ║
 * ║  ✅ OTP Login (Email/WhatsApp)                                                  ║
 * ║  ✅ Salla OAuth Login                                                           ║
 * ║  ✅ Set Password (بعد أول OTP/OAuth login)                                      ║
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
import { LoginDto, RegisterDto, TokensDto, OtpChannelDto } from './dto';
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

/**
 * 📌 Verification Method Interface (for getVerificationMethods)
 */
interface VerificationMethod {
  type: OtpChannelDto;
  available: boolean;
  maskedValue: string;
  label: string;
  icon: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
    private readonly storesService: StoresService,
    private readonly whatsAppOtpService: WhatsAppOtpService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Email + Password Login
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔐 تسجيل الدخول بالإيميل والباسورد
   */
  async login(dto: LoginDto): Promise<TokensDto & { needsPassword: boolean }> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
      select: ['id', 'email', 'password', 'status', 'tenantId', 'role', 'firstName', 'lastName', 'preferences'],
    });

    if (!user) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    // التحقق من أن المستخدم قد عيّن باسورد
    const hasSetPassword = (user.preferences as any)?.hasSetPassword !== false;
    
    if (!hasSetPassword) {
      throw new UnauthorizedException('يرجى تعيين كلمة مرور أولاً. استخدم رمز OTP لتسجيل الدخول.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    const tokens = await this.generateTokens(user);

    await this.userRepository.update(user.id, {
      refreshToken: tokens.refreshToken,
      lastLoginAt: new Date(),
    });

    return {
      ...tokens,
      needsPassword: false,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 Set Password (بعد أول OTP/OAuth login)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔑 تعيين كلمة مرور جديدة
   */
  async setPassword(
    userId: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'preferences'],
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const updatedPreferences = {
      ...(user.preferences as object || {}),
      hasSetPassword: true,
      passwordSetAt: new Date().toISOString(),
    };

    await this.userRepository.update(userId, {
      password: hashedPassword,
      preferences: updatedPreferences,
    });

    this.logger.log(`🔑 Password set for user: ${userId}`);

    return {
      success: true,
      message: 'تم تعيين كلمة المرور بنجاح',
    };
  }

  /**
   * 🔐 تغيير كلمة المرور (للمستخدم المسجل)
   */
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
      throw new BadRequestException('المستخدم غير موجود');
    }

    const hasSetPassword = (user.preferences as any)?.hasSetPassword;
    
    if (hasSetPassword) {
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        throw new BadRequestException('كلمة المرور الحالية غير صحيحة');
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const updatedPreferences = {
      ...(user.preferences as object || {}),
      hasSetPassword: true,
      passwordChangedAt: new Date().toISOString(),
    };

    await this.userRepository.update(userId, {
      password: hashedPassword,
      preferences: updatedPreferences,
      refreshToken: undefined,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 OTP Login (Email/WhatsApp)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 📋 جلب طرق التحقق المتاحة للتاجر
   */
  async getVerificationMethods(merchantId: number): Promise<{
    merchantId: number;
    storeName: string;
    methods: VerificationMethod[];
  }> {
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (!store) {
      throw new NotFoundException('المتجر غير موجود. يرجى تثبيت تطبيق RAFEQ من متجر سلة أولاً.');
    }

    const methods: VerificationMethod[] = [];

    if (store.sallaEmail) {
      methods.push({
        type: OtpChannelDto.EMAIL,
        available: true,
        maskedValue: this.maskEmail(store.sallaEmail),
        label: 'البريد الإلكتروني',
        icon: 'email',
      });
    }

    if (store.sallaMobile && this.whatsAppOtpService.isWhatsAppConfigured()) {
      methods.push({
        type: OtpChannelDto.WHATSAPP,
        available: true,
        maskedValue: this.maskPhone(store.sallaMobile),
        label: 'واتساب',
        icon: 'whatsapp',
      });
    }

    if (methods.length === 0) {
      throw new BadRequestException('لا تتوفر طرق تحقق للمتجر. يرجى التواصل مع الدعم.');
    }

    return {
      merchantId,
      storeName: store.sallaStoreName || store.name || 'متجرك',
      methods,
    };
  }

  /**
   * 📤 إرسال OTP للتاجر
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
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (!store) {
      throw new NotFoundException('المتجر غير موجود');
    }

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

    const otpChannel = channel === OtpChannelDto.WHATSAPP ? OtpChannel.WHATSAPP : OtpChannel.EMAIL;
    const { otp, expiresAt } = await this.otpService.generateOtp(identifier, otpChannel, {
      merchantId,
      tenantId: store.tenantId,
      email: store.sallaEmail,
      phone: store.sallaMobile,
    });

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
      await this.otpService.deleteOtp(identifier, otpChannel);
      throw new BadRequestException(`فشل في إرسال رمز التحقق. يرجى المحاولة لاحقاً.`);
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
   */
  async verifyOtpAndLogin(
    merchantId: number,
    otp: string,
    channel: OtpChannelDto = OtpChannelDto.EMAIL,
  ): Promise<TokensDto & { isFirstLogin: boolean; userId: string; tenantId: string; needsPassword: boolean }> {
    const store = await this.storesService.findByMerchantId(merchantId);
    
    if (!store) {
      throw new BadRequestException('المتجر غير موجود');
    }

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

    const otpChannel = channel === OtpChannelDto.WHATSAPP ? OtpChannel.WHATSAPP : OtpChannel.EMAIL;
    const verification = await this.otpService.verifyOtp(identifier, otp, otpChannel);

    if (!verification.valid) {
      throw new UnauthorizedException('رمز التحقق غير صحيح');
    }

    const email = store.sallaEmail || verification.email;
    
    if (!email) {
      throw new BadRequestException('البريد الإلكتروني غير متوفر للمتجر');
    }

    let user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'password', 'status', 'tenantId', 'role', 'firstName', 'lastName', 'preferences'],
    });

    let isFirstLogin = false;
    let needsPassword = false;

    if (!user) {
      const tempPassword = nanoid(32);
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
          hasSetPassword: false,
        },
      });

      await this.userRepository.save(user);
      isFirstLogin = true;
      needsPassword = true;

      this.logger.log(`👤 New user created via OTP`, { userId: user.id, email: user.email, merchantId });
    } else {
      needsPassword = (user.preferences as any)?.hasSetPassword === false;
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    const tokens = await this.generateTokens(user);

    await this.userRepository.update(user.id, {
      refreshToken: tokens.refreshToken,
      lastLoginAt: new Date(),
      emailVerified: true,
    });

    this.logger.log(`✅ User logged in via OTP`, { userId: user.id, isFirstLogin, needsPassword });

    return {
      ...tokens,
      isFirstLogin,
      userId: user.id,
      tenantId: user.tenantId,
      needsPassword,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Salla OAuth Login
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🔐 تسجيل الدخول عبر Salla OAuth
   */
  async loginViaSallaOAuth(
    merchantId: number,
    merchantInfo: {
      email: string;
      name: string;
      mobile?: string;
      avatar?: string;
    },
    tenantId: string,
  ): Promise<TokensDto & { isFirstLogin: boolean; userId: string; tenantId: string; needsPassword: boolean; merchantId: number }> {
    const email = merchantInfo.email;
    
    if (!email) {
      throw new BadRequestException('البريد الإلكتروني غير متوفر');
    }

    let user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'password', 'status', 'tenantId', 'role', 'firstName', 'lastName', 'preferences'],
    });

    let isFirstLogin = false;
    let needsPassword = false;

    if (!user) {
      const tempPassword = nanoid(32);
      const hashedPassword = await bcrypt.hash(tempPassword, 12);

      const nameParts = (merchantInfo.name || 'مستخدم رفيق').split(' ');

      user = this.userRepository.create({
        tenantId: tenantId,
        email: email.toLowerCase(),
        password: hashedPassword,
        firstName: nameParts[0] || 'مستخدم',
        lastName: nameParts.slice(1).join(' ') || 'رفيق',
        phone: merchantInfo.mobile,
        avatar: merchantInfo.avatar,
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        preferences: {
          source: 'salla_oauth',
          merchantId: merchantId,
          hasSetPassword: false,
        },
      });

      await this.userRepository.save(user);
      isFirstLogin = true;
      needsPassword = true;

      this.logger.log(`👤 New user created via Salla OAuth`, { userId: user.id, email: user.email, merchantId });
    } else {
      needsPassword = (user.preferences as any)?.hasSetPassword === false;
      
      if (user.tenantId !== tenantId) {
        await this.userRepository.update(user.id, { tenantId });
        user.tenantId = tenantId;
      }
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    const tokens = await this.generateTokens(user);

    await this.userRepository.update(user.id, {
      refreshToken: tokens.refreshToken,
      lastLoginAt: new Date(),
    });

    this.logger.log(`✅ User logged in via Salla OAuth`, { userId: user.id, isFirstLogin });

    return {
      ...tokens,
      isFirstLogin,
      userId: user.id,
      tenantId: user.tenantId,
      needsPassword,
      merchantId,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 Token Management
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshTokens(refreshToken: string): Promise<TokensDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('jwt.secret'),
      });

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

      const tokens = await this.generateTokens(user);

      await this.userRepository.update(user.id, {
        refreshToken: tokens.refreshToken,
      });

      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      refreshToken: undefined,
    });
  }

  async register(dto: RegisterDto): Promise<TokensDto> {
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('البريد الإلكتروني مستخدم مسبقاً');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const slug = this.generateSlug(dto.storeName);
      
      const tenant = queryRunner.manager.create(Tenant, {
        name: dto.storeName,
        slug: slug,
        email: dto.email.toLowerCase(),
        status: TenantStatus.TRIAL,
        subscriptionPlan: SubscriptionPlan.FREE,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        settings: {
          ai: { enabled: true, tone: 'friendly', language: 'ar', autoHandoff: true, handoffAfterFailures: 3 },
          privacy: { requireVerification: true, verificationMethods: ['otp'], maskOrderDetails: true },
        },
        timezone: 'Asia/Riyadh',
        defaultLanguage: 'ar',
        currency: 'SAR',
        monthlyMessageLimit: 1000,
      });

      const savedTenant = await queryRunner.manager.save(tenant);

      const hashedPassword = await bcrypt.hash(dto.password, 12);

      const user = queryRunner.manager.create(User, {
        tenantId: savedTenant.id,
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        preferences: {
          source: 'register',
          hasSetPassword: true,
        },
      });

      const savedUser = await queryRunner.manager.save(user);
      await queryRunner.commitTransaction();

      const tokens = await this.generateTokens(savedUser);

      await this.userRepository.update(savedUser.id, {
        refreshToken: tokens.refreshToken,
      });

      return tokens;
    } catch (error: any) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

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

    const otpChannel = channel === OtpChannelDto.WHATSAPP ? OtpChannel.WHATSAPP : OtpChannel.EMAIL;
    const { otp, expiresAt } = await this.otpService.generateOtp(identifier, otpChannel, {
      merchantId,
      tenantId,
      email,
      phone,
    });

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private async generateTokens(user: Partial<User>): Promise<TokensDto> {
    const payload: JwtPayload = {
      sub: user.id!,
      email: user.email!,
      tenantId: user.tenantId!,
      role: user.role!,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.expiresIn', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.refreshExpiresIn', '7d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private generateSlug(name: string): string {
    const arabicToLatin: Record<string, string> = {
      'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
      'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z',
      'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
      'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
      'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h', 'ء': 'a',
    };

    let slug = name.toLowerCase();
    
    for (const [arabic, latin] of Object.entries(arabicToLatin)) {
      slug = slug.replace(new RegExp(arabic, 'g'), latin);
    }
    
    slug = slug.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
    
    if (!slug) slug = 'store';
    
    return `${slug}-${nanoid(6)}`;
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!domain) return email;
    if (localPart.length <= 2) return `${localPart[0]}***@${domain}`;
    return `${localPart.slice(0, 2)}***${localPart.slice(-1)}@${domain}`;
  }

  private maskPhone(phone: string): string {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 8) return phone;
    const countryCode = cleanPhone.slice(0, 3);
    const lastFour = cleanPhone.slice(-4);
    return `${countryCode}****${lastFour}`;
  }
}
