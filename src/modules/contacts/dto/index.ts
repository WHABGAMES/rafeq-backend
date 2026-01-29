/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Contacts DTOs                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsOptional,
  IsEmail,
  IsArray,
  IsObject,
  IsBoolean,
  IsEnum,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Create Contact DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateContactDto {
  @ApiProperty({ description: 'اسم العميل' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'رقم الهاتف' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ description: 'البريد الإلكتروني' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'الاسم الأول' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'الاسم الأخير' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'القناة التي جاء منها العميل' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ description: 'معرف العميل في سلة/زد' })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ description: 'التصنيفات' })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: 'بيانات إضافية' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'الصورة الشخصية' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: 'المدينة' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'الدولة' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'العنوان' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'اللغة المفضلة' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'ملاحظات' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Contact DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateContactDto {
  @ApiPropertyOptional({ description: 'اسم العميل' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'رقم الهاتف' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'البريد الإلكتروني' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'الاسم الأول' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'الاسم الأخير' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'التصنيفات' })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: 'بيانات إضافية' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'الصورة الشخصية' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: 'المدينة' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'الدولة' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'العنوان' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'اللغة المفضلة' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'ملاحظات' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Contact Filters DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class ContactFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasOrders?: boolean;

  @ApiPropertyOptional({ enum: ['createdAt', 'lastActivity', 'totalOrders', 'name'] })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Import Contacts DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class ImportContactsDto {
  @ApiPropertyOptional({ description: 'إضافة تصنيفات لجميع المستوردين' })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: 'تجاوز التكرارات' })
  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;

  @ApiPropertyOptional({ description: 'تحديث الموجودين' })
  @IsOptional()
  @IsBoolean()
  updateExisting?: boolean;

  @ApiPropertyOptional({ description: 'ربط الأعمدة' })
  @IsOptional()
  @IsObject()
  columnMapping?: {
    name?: string;
    phone?: string;
    email?: string;
    [key: string]: string | undefined;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Segment DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateSegmentDto {
  @ApiProperty({ description: 'اسم الشريحة' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'وصف الشريحة' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'شروط الشريحة' })
  @IsArray()
  conditions: SegmentCondition[];

  @ApiPropertyOptional({ description: 'منطق الشروط', enum: ['AND', 'OR'] })
  @IsOptional()
  @IsEnum(['AND', 'OR'])
  logic?: 'AND' | 'OR';
}

export class SegmentCondition {
  @ApiProperty({ description: 'الحقل' })
  @IsString()
  field: string;

  @ApiProperty({ description: 'العملية', enum: ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in', 'not_in', 'exists', 'not_exists'] })
  @IsString()
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'in' | 'not_in' | 'exists' | 'not_exists';

  @ApiProperty({ description: 'القيمة' })
  value: string | number | boolean | string[];
}
