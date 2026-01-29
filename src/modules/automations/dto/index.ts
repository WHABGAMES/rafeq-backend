/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Automations DTOs                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsOptional,
  IsArray,
  IsObject,
  IsBoolean,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════════════════════
// Action DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class AutomationActionDto {
  @ApiProperty({ description: 'نوع الإجراء' })
  @IsString()
  type: string;

  @ApiPropertyOptional({ description: 'إعدادات الإجراء' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'الترتيب' })
  @IsOptional()
  order?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Condition DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class AutomationConditionDto {
  @ApiProperty({ description: 'الحقل' })
  @IsString()
  field: string;

  @ApiProperty({ description: 'العملية' })
  @IsString()
  operator: string;

  @ApiProperty({ description: 'القيمة' })
  value: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Automation DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateAutomationDto {
  @ApiProperty({ description: 'اسم الأتمتة' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'وصف الأتمتة' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'المحفز (Trigger)' })
  @IsString()
  trigger: string;

  @ApiPropertyOptional({ description: 'شروط المحفز' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationConditionDto)
  conditions?: AutomationConditionDto[];

  @ApiProperty({ description: 'الإجراءات', type: [AutomationActionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions: AutomationActionDto[];

  @ApiPropertyOptional({ description: 'تأخير قبل التنفيذ (بالدقائق)' })
  @IsOptional()
  delay?: number;

  @ApiPropertyOptional({ description: 'وحدة التأخير' })
  @IsOptional()
  @IsString()
  delayUnit?: 'minutes' | 'hours' | 'days';

  @ApiPropertyOptional({ description: 'تفعيل تلقائي' })
  @IsOptional()
  @IsBoolean()
  autoActivate?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Automation DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateAutomationDto {
  @ApiPropertyOptional({ description: 'اسم الأتمتة' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'وصف الأتمتة' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'المحفز' })
  @IsOptional()
  @IsString()
  trigger?: string;

  @ApiPropertyOptional({ description: 'شروط المحفز' })
  @IsOptional()
  @IsArray()
  conditions?: AutomationConditionDto[];

  @ApiPropertyOptional({ description: 'الإجراءات' })
  @IsOptional()
  @IsArray()
  actions?: AutomationActionDto[];

  @ApiPropertyOptional({ description: 'تأخير' })
  @IsOptional()
  delay?: number;

  @ApiPropertyOptional({ description: 'وحدة التأخير' })
  @IsOptional()
  @IsString()
  delayUnit?: 'minutes' | 'hours' | 'days';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow Step DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class WorkflowStepDto {
  @ApiProperty({ description: 'معرف الخطوة' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'نوع الخطوة' })
  @IsString()
  type: 'action' | 'condition' | 'delay' | 'split';

  @ApiPropertyOptional({ description: 'إعدادات الخطوة' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'الخطوة التالية' })
  @IsOptional()
  @IsString()
  nextStepId?: string;

  @ApiPropertyOptional({ description: 'الخطوات التالية (للشروط)' })
  @IsOptional()
  @IsObject()
  branches?: {
    condition: AutomationConditionDto[];
    nextStepId: string;
  }[];

  @ApiPropertyOptional({ description: 'موقع الخطوة في المحرر' })
  @IsOptional()
  @IsObject()
  position?: { x: number; y: number };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Workflow DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateWorkflowDto {
  @ApiProperty({ description: 'اسم الـ Workflow' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'الوصف' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'المحفز' })
  @IsString()
  trigger: string;

  @ApiPropertyOptional({ description: 'شروط المحفز' })
  @IsOptional()
  @IsArray()
  triggerConditions?: AutomationConditionDto[];

  @ApiProperty({ description: 'خطوات الـ Workflow', type: [WorkflowStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps: WorkflowStepDto[];

  @ApiPropertyOptional({ description: 'معرف الخطوة الأولى' })
  @IsOptional()
  @IsString()
  entryStepId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Workflow DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateWorkflowDto {
  @ApiPropertyOptional({ description: 'اسم الـ Workflow' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'الوصف' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'المحفز' })
  @IsOptional()
  @IsString()
  trigger?: string;

  @ApiPropertyOptional({ description: 'شروط المحفز' })
  @IsOptional()
  @IsArray()
  triggerConditions?: AutomationConditionDto[];

  @ApiPropertyOptional({ description: 'الخطوات' })
  @IsOptional()
  @IsArray()
  steps?: WorkflowStepDto[];

  @ApiPropertyOptional({ description: 'معرف الخطوة الأولى' })
  @IsOptional()
  @IsString()
  entryStepId?: string;

  @ApiPropertyOptional({ description: 'الحالة' })
  @IsOptional()
  @IsString()
  status?: 'draft' | 'active' | 'inactive';
}
