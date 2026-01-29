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
} from 'class-validator';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 LOGIN DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات تسجيل الدخول
 * 
 * POST /api/v1/auth/login
 * {
 *   "email": "user@example.com",
 *   "password": "password123"
 * }
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
 * POST /api/v1/auth/register
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
 * POST /api/v1/auth/refresh
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
  })
  expiresIn: number;
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
