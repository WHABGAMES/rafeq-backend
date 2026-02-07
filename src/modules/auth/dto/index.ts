/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth DTOs                                  ║
 * ║                                                                                ║
 * ║  ✅ v7: Multi-Auth Support + Forgot Password                                 ║
 * ║  🔑 Email + Password                                                          ║
 * ║  📧 Email OTP (رمز تحقق عبر الإيميل)                                          ║
 * ║  🔵 Google OAuth                                                              ║
 * ║  🟢 Salla OAuth                                                               ║
 * ║  🟣 Zid OAuth                                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsEmail, IsString, IsNotEmpty, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔑 LOGIN - Email + Password
// ═══════════════════════════════════════════════════════════════════════════════

export class LoginDto {
  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({ description: 'رمز الدخول', example: 'Aa966512345678' })
  @IsString({ message: 'رمز الدخول يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'رمز الدخول مطلوب' })
  password: string;
}

export class LoginResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty() user: {
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

// ═══════════════════════════════════════════════════════════════════════════════
// 📝 REGISTER
// ═══════════════════════════════════════════════════════════════════════════════

export class RegisterDto {
  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  @MaxLength(255, { message: 'البريد الإلكتروني طويل جداً' })
  email: string;

  @ApiProperty({ description: 'رمز الدخول', example: 'MyPassword123' })
  @IsString()
  @MinLength(8, { message: 'رمز الدخول يجب أن يكون 8 أحرف على الأقل' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'رمز الدخول يجب أن يحتوي على حرف كبير وحرف صغير ورقم',
  })
  password: string;

  @ApiProperty({ description: 'الاسم الكامل', example: 'محمد أحمد' })
  @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'اسم المتجر' })
  @IsString() @IsOptional() @MaxLength(200)
  storeName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📧 CHECK EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export class CheckEmailDto {
  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;
}

export class CheckEmailResponseDto {
  @ApiProperty() exists: boolean;
  @ApiProperty() hasPassword: boolean;
  @ApiPropertyOptional() authProvider?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📧 EMAIL OTP
// ═══════════════════════════════════════════════════════════════════════════════

export class SendEmailOtpDto {
  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;
}

export class VerifyEmailOtpDto {
  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'رمز التحقق', example: '123456' })
  @IsString() @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'رمز التحقق يجب أن يكون 6 أرقام' })
  otp: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔵 GOOGLE OAuth
// ═══════════════════════════════════════════════════════════════════════════════

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google ID Token' })
  @IsString() @IsNotEmpty({ message: 'Google token مطلوب' })
  idToken: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🟢 SALLA OAuth
// ═══════════════════════════════════════════════════════════════════════════════

export class SallaAuthDto {
  @ApiProperty({ description: 'كود التفويض من Salla' })
  @IsString() @IsNotEmpty({ message: 'Salla auth code مطلوب' })
  code: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  state?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🟣 ZID OAuth
// ═══════════════════════════════════════════════════════════════════════════════

export class ZidAuthDto {
  @ApiProperty({ description: 'كود التفويض من Zid' })
  @IsString() @IsNotEmpty({ message: 'Zid auth code مطلوب' })
  code: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  state?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 SET PASSWORD (OAuth/OTP users)
// ═══════════════════════════════════════════════════════════════════════════════

export class SetPasswordDto {
  @ApiProperty({ description: 'رمز الدخول الجديد', example: 'MyNewPassword123' })
  @IsString()
  @MinLength(8, { message: 'رمز الدخول يجب أن يكون 8 أحرف على الأقل' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'رمز الدخول يجب أن يحتوي على حرف كبير وحرف صغير ورقم',
  })
  password: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 REFRESH TOKEN
// ═══════════════════════════════════════════════════════════════════════════════

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh Token' })
  @IsString() @IsNotEmpty({ message: 'Refresh token مطلوب' })
  refreshToken: string;
}

export class RefreshTokenResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 CHANGE PASSWORD
// ═══════════════════════════════════════════════════════════════════════════════

export class ChangePasswordDto {
  @ApiProperty({ description: 'رمز الدخول الحالي' })
  @IsString() @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: 'رمز الدخول الجديد' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'رمز الدخول يجب أن يحتوي على حرف كبير وحرف صغير ورقم',
  })
  newPassword: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 FORGOT PASSWORD - استعادة كلمة المرور
// ═══════════════════════════════════════════════════════════════════════════════

export class ForgotPasswordDto {
  @ApiProperty({ description: 'البريد الإلكتروني المسجل', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;
}

export class VerifyResetTokenDto {
  @ApiProperty({ description: 'توكن استعادة كلمة المرور' })
  @IsString() @IsNotEmpty({ message: 'التوكن مطلوب' })
  token: string;

  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'توكن استعادة كلمة المرور' })
  @IsString() @IsNotEmpty({ message: 'التوكن مطلوب' })
  token: string;

  @ApiProperty({ description: 'البريد الإلكتروني', example: 'merchant@example.com' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({ description: 'كلمة المرور الجديدة', example: 'NewPassword123' })
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم',
  })
  newPassword: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 👤 USER PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

export class UserProfileDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() avatar?: string;
  @ApiProperty() role: string;
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() authProvider?: string;
  @ApiPropertyOptional() preferences?: Record<string, any>;
  @ApiProperty() createdAt: Date;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'تمت العملية بنجاح' })
  message: string;
}
