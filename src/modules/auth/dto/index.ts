/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth DTOs                                  ║
 * ║                                                                                ║
 * ║  📌 ماهو DTO؟                                                                   ║
 * ║  Data Transfer Object = كائن لنقل البيانات                                      ║
 * ║                                                                                ║
 * ║  يُستخدم لـ:                                                                    ║
 * ║  - تحديد شكل البيانات المتوقعة                                                  ║
 * ║  - التحقق من صحة البيانات (Validation)                                          ║
 * ║  - توثيق الـ API (Swagger)                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsNumber,
  IsOptional,
  IsIn,
  Length,
} from 'class-validator';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 LOGIN DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات تسجيل الدخول
 * 
 * POST /api/auth/login
 */
export class LoginDto {
  @ApiProperty({
    description: 'البريد الإلكتروني',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({
    description: 'كلمة المرور',
    example: 'password123',
  })
  @IsString({ message: 'كلمة المرور يجب أن تكون نص' })
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📝 REGISTER DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات إنشاء حساب جديد
 * 
 * POST /api/auth/register
 */
export class RegisterDto {
  @ApiProperty({
    description: 'البريد الإلكتروني',
    example: 'newuser@example.com',
  })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({
    description: 'كلمة المرور (8-50 حرف، يجب أن تحتوي على حرف كبير ورقم)',
    example: 'Password123',
  })
  @IsString({ message: 'كلمة المرور يجب أن تكون نص' })
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @MaxLength(50, { message: 'كلمة المرور يجب ألا تتجاوز 50 حرف' })
  @Matches(
    /^(?=.*[A-Z])(?=.*[0-9])/,
    { message: 'كلمة المرور يجب أن تحتوي على حرف كبير ورقم على الأقل' },
  )
  password: string;

  @ApiProperty({
    description: 'الاسم الأول',
    example: 'محمد',
  })
  @IsString({ message: 'الاسم الأول يجب أن يكون نص' })
  @IsNotEmpty({ message: 'الاسم الأول مطلوب' })
  @MinLength(2, { message: 'الاسم الأول يجب أن يكون حرفين على الأقل' })
  @MaxLength(50, { message: 'الاسم الأول يجب ألا يتجاوز 50 حرف' })
  firstName: string;

  @ApiProperty({
    description: 'الاسم الأخير',
    example: 'أحمد',
  })
  @IsString({ message: 'الاسم الأخير يجب أن يكون نص' })
  @IsNotEmpty({ message: 'الاسم الأخير مطلوب' })
  @MinLength(2, { message: 'الاسم الأخير يجب أن يكون حرفين على الأقل' })
  @MaxLength(50, { message: 'الاسم الأخير يجب ألا يتجاوز 50 حرف' })
  lastName: string;

  @ApiProperty({
    description: 'اسم المتجر/الشركة',
    example: 'متجر الإلكترونيات',
  })
  @IsString({ message: 'اسم المتجر يجب أن يكون نص' })
  @IsNotEmpty({ message: 'اسم المتجر مطلوب' })
  @MinLength(3, { message: 'اسم المتجر يجب أن يكون 3 أحرف على الأقل' })
  @MaxLength(100, { message: 'اسم المتجر يجب ألا يتجاوز 100 حرف' })
  storeName: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 REFRESH TOKEN DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات تجديد الـ Token
 * 
 * POST /api/auth/refresh
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh Token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString({ message: 'الـ Token يجب أن يكون نص' })
  @IsNotEmpty({ message: 'الـ Refresh Token مطلوب' })
  refreshToken: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔑 TOKENS RESPONSE DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * الـ Response بعد تسجيل الدخول الناجح
 */
export class TokensDto {
  @ApiProperty({
    description: 'Access Token للوصول للـ API',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Refresh Token لتجديد الـ Access Token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'مدة صلاحية الـ Access Token بالثواني',
    example: 900,
    required: false,
  })
  expiresIn?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔑 SET PASSWORD DTO (جديد - بعد OTP/OAuth login)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * تعيين كلمة مرور جديدة بعد أول تسجيل دخول بـ OTP أو Salla OAuth
 * 
 * POST /api/auth/set-password
 */
export class SetPasswordDto {
  @ApiProperty({
    description: 'كلمة المرور الجديدة (8-50 حرف، يجب أن تحتوي على حرف كبير ورقم)',
    example: 'NewPassword123',
  })
  @IsString({ message: 'كلمة المرور يجب أن تكون نص' })
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @MaxLength(50, { message: 'كلمة المرور يجب ألا تتجاوز 50 حرف' })
  @Matches(
    /^(?=.*[A-Z])(?=.*[0-9])/,
    { message: 'كلمة المرور يجب أن تحتوي على حرف كبير ورقم على الأقل' },
  )
  password: string;

  @ApiProperty({
    description: 'تأكيد كلمة المرور',
    example: 'NewPassword123',
  })
  @IsString({ message: 'تأكيد كلمة المرور يجب أن يكون نص' })
  @IsNotEmpty({ message: 'تأكيد كلمة المرور مطلوب' })
  confirmPassword: string;
}

/**
 * Response بعد تعيين كلمة المرور بنجاح
 */
export class SetPasswordResponseDto {
  @ApiProperty({
    description: 'هل تمت العملية بنجاح',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'رسالة',
    example: 'تم تعيين كلمة المرور بنجاح',
  })
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔒 CHANGE PASSWORD DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات تغيير كلمة المرور
 */
export class ChangePasswordDto {
  @ApiProperty({
    description: 'كلمة المرور الحالية',
    example: 'OldPassword123',
  })
  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور الحالية مطلوبة' })
  currentPassword: string;

  @ApiProperty({
    description: 'كلمة المرور الجديدة',
    example: 'NewPassword456',
  })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @Matches(
    /^(?=.*[A-Z])(?=.*[0-9])/,
    { message: 'كلمة المرور يجب أن تحتوي على حرف كبير ورقم على الأقل' },
  )
  newPassword: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📧 FORGOT PASSWORD DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات طلب استعادة كلمة المرور
 */
export class ForgotPasswordDto {
  @ApiProperty({
    description: 'البريد الإلكتروني',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;
}

/**
 * بيانات إعادة تعيين كلمة المرور
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'رمز إعادة التعيين',
    example: 'abc123def456',
  })
  @IsString()
  @IsNotEmpty({ message: 'رمز إعادة التعيين مطلوب' })
  token: string;

  @ApiProperty({
    description: 'كلمة المرور الجديدة',
    example: 'NewPassword123',
  })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @Matches(
    /^(?=.*[A-Z])(?=.*[0-9])/,
    { message: 'كلمة المرور يجب أن تحتوي على حرف كبير ورقم على الأقل' },
  )
  newPassword: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 OTP DTOs - للتسجيل الدخول من سلة
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * قنوات إرسال OTP
 */
export enum OtpChannelDto {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

/**
 * جلب طرق التحقق المتاحة للتاجر
 * 
 * GET /api/auth/otp/methods?merchant_id=426101474
 */
export class GetVerificationMethodsDto {
  @ApiProperty({
    description: 'رقم التاجر في سلة',
    example: 426101474,
  })
  @IsNumber({}, { message: 'رقم التاجر يجب أن يكون رقم' })
  @IsNotEmpty({ message: 'رقم التاجر مطلوب' })
  merchantId: number;
}

/**
 * طريقة التحقق المتاحة
 */
export class VerificationMethodDto {
  @ApiProperty({
    description: 'القناة',
    enum: OtpChannelDto,
    example: 'email',
  })
  channel: OtpChannelDto;

  @ApiProperty({
    description: 'القيمة المخفية',
    example: 'fo***h@gmail.com',
  })
  maskedValue: string;

  @ApiProperty({
    description: 'هل متاحة للاستخدام',
    example: true,
  })
  isAvailable: boolean;
}

/**
 * Response طرق التحقق المتاحة
 */
export class VerificationMethodsResponseDto {
  @ApiProperty({
    description: 'رقم التاجر',
    example: 426101474,
    required: false,
  })
  merchantId?: number;

  @ApiProperty({
    description: 'اسم المتجر',
    example: 'متجر الإلكترونيات',
  })
  storeName?: string;

  @ApiProperty({
    description: 'اسم المتجر (deprecated - استخدم storeName)',
    example: 'متجر الإلكترونيات',
    required: false,
    deprecated: true,
  })
  merchantName?: string;

  @ApiProperty({
    description: 'طرق التحقق المتاحة',
    type: [VerificationMethodDto],
  })
  methods: VerificationMethodDto[] | any[];
}

/**
 * طلب إرسال OTP للتاجر من سلة
 * 
 * POST /api/auth/otp/send
 */
export class SendOtpDto {
  @ApiProperty({
    description: 'رقم التاجر في سلة',
    example: 426101474,
  })
  @IsNumber({}, { message: 'رقم التاجر يجب أن يكون رقم' })
  @IsNotEmpty({ message: 'رقم التاجر مطلوب' })
  merchantId: number;

  @ApiProperty({
    description: 'قناة الإرسال',
    enum: OtpChannelDto,
    example: 'email',
    required: false,
    default: 'email',
  })
  @IsString({ message: 'القناة يجب أن تكون نص' })
  @IsIn(['email', 'whatsapp'], { message: 'القناة يجب أن تكون email أو whatsapp' })
  @IsOptional()
  channel?: OtpChannelDto = OtpChannelDto.EMAIL;
}

/**
 * التحقق من OTP
 * 
 * POST /api/auth/otp/verify
 */
export class VerifyOtpDto {
  @ApiProperty({
    description: 'رقم التاجر في سلة',
    example: 426101474,
  })
  @IsNumber({}, { message: 'رقم التاجر يجب أن يكون رقم' })
  @IsNotEmpty({ message: 'رقم التاجر مطلوب' })
  merchantId: number;

  @ApiProperty({
    description: 'رمز التحقق (6 أرقام)',
    example: '123456',
  })
  @IsString({ message: 'رمز التحقق يجب أن يكون نص' })
  @IsNotEmpty({ message: 'رمز التحقق مطلوب' })
  @Length(6, 6, { message: 'رمز التحقق يجب أن يكون 6 أرقام' })
  @Matches(/^\d{6}$/, { message: 'رمز التحقق يجب أن يكون 6 أرقام فقط' })
  otp: string;

  @ApiProperty({
    description: 'قناة التحقق',
    enum: OtpChannelDto,
    example: 'email',
    required: false,
    default: 'email',
  })
  @IsString({ message: 'القناة يجب أن تكون نص' })
  @IsIn(['email', 'whatsapp'], { message: 'القناة يجب أن تكون email أو whatsapp' })
  @IsOptional()
  channel?: OtpChannelDto = OtpChannelDto.EMAIL;
}

/**
 * إعادة إرسال OTP
 * 
 * POST /api/auth/otp/resend
 */
export class ResendOtpDto {
  @ApiProperty({
    description: 'المُعرّف (البريد الإلكتروني أو رقم الهاتف)',
    example: 'merchant@example.com',
  })
  @IsString({ message: 'المُعرّف يجب أن يكون نص' })
  @IsNotEmpty({ message: 'المُعرّف مطلوب' })
  identifier: string;

  @ApiProperty({
    description: 'رقم التاجر في سلة (اختياري)',
    example: 426101474,
    required: false,
  })
  @IsNumber({}, { message: 'رقم التاجر يجب أن يكون رقم' })
  @IsOptional()
  merchantId?: number;

  @ApiProperty({
    description: 'قناة الإرسال',
    enum: OtpChannelDto,
    example: 'email',
    required: false,
    default: 'email',
  })
  @IsString({ message: 'القناة يجب أن تكون نص' })
  @IsIn(['email', 'whatsapp'], { message: 'القناة يجب أن تكون email أو whatsapp' })
  @IsOptional()
  channel?: OtpChannelDto = OtpChannelDto.EMAIL;
}

/**
 * Response بعد إرسال OTP
 */
export class OtpSentResponseDto {
  @ApiProperty({
    description: 'هل تم الإرسال بنجاح',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'رسالة',
    example: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني',
  })
  message: string;

  @ApiProperty({
    description: 'القناة المُستخدمة',
    enum: OtpChannelDto,
    example: 'email',
  })
  channel: OtpChannelDto;

  @ApiProperty({
    description: 'القيمة المخفية (بريد أو رقم هاتف)',
    example: 'fo***h@gmail.com',
  })
  maskedValue: string;

  @ApiProperty({
    description: 'تاريخ انتهاء صلاحية الرمز',
    example: '2025-02-01T15:30:00.000Z',
  })
  expiresAt: Date;
}

/**
 * Response بعد التحقق من OTP - يحتوي على Tokens
 */
export class OtpVerifiedResponseDto extends TokensDto {
  @ApiProperty({
    description: 'هل أول تسجيل دخول',
    example: true,
  })
  isFirstLogin: boolean;

  @ApiProperty({
    description: 'معرف التاجر',
    example: 'uuid-here',
  })
  userId: string;

  @ApiProperty({
    description: 'معرف المتجر',
    example: 'uuid-here',
  })
  tenantId: string;

  @ApiProperty({
    description: 'هل يحتاج لتعيين كلمة مرور',
    example: true,
  })
  needsPassword: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔗 Salla OAuth DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Response بعد تسجيل الدخول عبر Salla OAuth
 */
export class SallaOAuthResponseDto extends TokensDto {
  @ApiProperty({
    description: 'هل أول تسجيل دخول',
    example: true,
  })
  isFirstLogin: boolean;

  @ApiProperty({
    description: 'معرف المستخدم',
    example: 'uuid-here',
  })
  userId: string;

  @ApiProperty({
    description: 'معرف المتجر (Tenant)',
    example: 'uuid-here',
  })
  tenantId: string;

  @ApiProperty({
    description: 'هل يحتاج لتعيين كلمة مرور',
    example: true,
  })
  needsPassword: boolean;

  @ApiProperty({
    description: 'رقم التاجر في سلة',
    example: 426101474,
  })
  merchantId: number;
}
