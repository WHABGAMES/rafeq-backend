/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users DTOs                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { UserRole, UserStatus } from '@database/entities';

// ═══════════════════════════════════════════════════════════════════════════════
// ➕ CREATE USER DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateUserDto {
  @ApiProperty({
    description: 'البريد الإلكتروني',
    example: 'employee@example.com',
  })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email: string;

  @ApiProperty({
    description: 'الاسم الأول',
    example: 'أحمد',
  })
  @IsString()
  @IsNotEmpty({ message: 'الاسم الأول مطلوب' })
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @ApiProperty({
    description: 'الاسم الأخير',
    example: 'محمد',
  })
  @IsString()
  @IsNotEmpty({ message: 'الاسم الأخير مطلوب' })
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @ApiPropertyOptional({
    description: 'رقم الهاتف',
    example: '+966501234567',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'الدور',
    enum: UserRole,
    example: UserRole.AGENT,
  })
  @IsOptional()
  @IsEnum(UserRole, { message: 'الدور غير صحيح' })
  role?: UserRole;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✏️ UPDATE USER DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'الاسم الأول',
    example: 'أحمد',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({
    description: 'الاسم الأخير',
    example: 'محمد',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({
    description: 'رقم الهاتف',
    example: '+966501234567',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'الدور',
    enum: UserRole,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'الحالة',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
