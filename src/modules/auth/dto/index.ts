/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth DTOs (Simplified)                    ║
 * ║                                                                                ║
 * ║  📌 DTOs للمصادقة المبسطة - Email + Password فقط                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsEmail, IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔑 LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

export class LoginDto {
  @ApiProperty({
    description: 'البريد الإلكتروني',
    example: 'merchant@example.com',
  })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({
    description: 'رمز الدخول',
    example: 'Aa966512345678',
  })
  @IsString({ message: 'رمز الدخول يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'رمز الدخول مطلوب' })
  password: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'Access Token' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh Token' })
  refreshToken: string;

  @ApiProperty({ description: 'بيانات المستخدم' })
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    avatar?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 REFRESH TOKEN
// ═══════════════════════════════════════════════════════════════════════════════

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh Token',
    example: 'eyJhbGciOiJIUzI1NiIs...',
  })
  @IsString({ message: 'Refresh token يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'Refresh token مطلوب' })
  refreshToken: string;
}

export class RefreshTokenResponseDto {
  @ApiProperty({ description: 'Access Token جديد' })
  accessToken: string;

  @ApiProperty({ description: 'Refresh Token جديد' })
  refreshToken: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 CHANGE PASSWORD
// ═══════════════════════════════════════════════════════════════════════════════

export class ChangePasswordDto {
  @ApiProperty({
    description: 'رمز الدخول الحالي',
    example: 'Aa966512345678',
  })
  @IsString({ message: 'رمز الدخول الحالي يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'رمز الدخول الحالي مطلوب' })
  currentPassword: string;

  @ApiProperty({
    description: 'رمز الدخول الجديد',
    example: 'MyNewPassword123',
  })
  @IsString({ message: 'رمز الدخول الجديد يجب أن يكون نصاً' })
  @MinLength(8, { message: 'رمز الدخول الجديد يجب أن يكون 8 أحرف على الأقل' })
  newPassword: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 👤 USER PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

export class UserProfileDto {
  @ApiProperty({ description: 'معرّف المستخدم' })
  id: string;

  @ApiProperty({ description: 'البريد الإلكتروني' })
  email: string;

  @ApiProperty({ description: 'الاسم الأول' })
  firstName: string;

  @ApiProperty({ description: 'اسم العائلة' })
  lastName: string;

  @ApiPropertyOptional({ description: 'رقم الجوال' })
  phone?: string;

  @ApiPropertyOptional({ description: 'صورة المستخدم' })
  avatar?: string;

  @ApiProperty({ description: 'الدور' })
  role: string;

  @ApiProperty({ description: 'معرّف المتجر' })
  tenantId: string;

  @ApiPropertyOptional({ description: 'الإعدادات' })
  preferences?: Record<string, any>;

  @ApiProperty({ description: 'تاريخ الإنشاء' })
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📝 MESSAGE RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

export class MessageResponseDto {
  @ApiProperty({
    description: 'رسالة النتيجة',
    example: 'تمت العملية بنجاح',
  })
  message: string;
}
