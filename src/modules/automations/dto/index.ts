/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Automation DTOs                                 ║
 * ║  ✅ التحقق من بيانات إنشاء وتحديث الأتمتات                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsOptional,
  IsArray,
  IsObject,
  IsUUID,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Trigger DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class AutomationTriggerDto {
  @ApiProperty({ description: 'نوع المحفز', example: 'order_created' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: 'شروط إضافية للتفعيل' })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Action DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class AutomationActionDto {
  @ApiProperty({ description: 'نوع الإجراء', example: 'send_whatsapp' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: 'إعدادات الإجراء' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'معرّف القالب' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ description: 'نص الرسالة' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ description: 'مدة التأخير بالثواني' })
  @IsOptional()
  delaySeconds?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Automation DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateAutomationDto {
  @ApiProperty({ description: 'اسم الأتمتة', example: 'إرسال رسالة ترحيب' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'وصف الأتمتة' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'معرّف المتجر' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ description: 'المحفز' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AutomationTriggerDto)
  trigger?: AutomationTriggerDto;

  @ApiPropertyOptional({ description: 'الإجراءات', type: [AutomationActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Automation DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateAutomationDto {
  @ApiPropertyOptional({ description: 'اسم الأتمتة' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'وصف الأتمتة' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'معرّف المتجر' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ description: 'المحفز' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AutomationTriggerDto)
  trigger?: AutomationTriggerDto;

  @ApiPropertyOptional({ description: 'الإجراءات', type: [AutomationActionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions?: AutomationActionDto[];
}
