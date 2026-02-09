/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Employee Notifications DTOs                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  IsBoolean,
  IsInt,
  IsUUID,
  Min,
  Max,
  MaxLength,
  ArrayMinSize,
  IsObject,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import {
  NotificationTriggerEvent,
  NotificationChannel,
} from '../entities/notification-rule.entity';

// ═══════════════════════════════════════════════════════════
// إنشاء قاعدة تنبيه جديدة
// ═══════════════════════════════════════════════════════════

export class CreateNotificationRuleDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(NotificationTriggerEvent)
  triggerEvent: NotificationTriggerEvent;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(NotificationChannel, { each: true })
  channels: NotificationChannel[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  recipientTypes: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  specificEmployeeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetRoles?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customPhones?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customEmails?: string[];

  // قوالب الرسائل
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dashboardTitle?: string;

  @IsOptional()
  @IsString()
  dashboardTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  emailSubject?: string;

  @IsOptional()
  @IsString()
  emailTemplate?: string;

  @IsOptional()
  @IsString()
  whatsappTemplate?: string;

  // فقرة تحفيزية
  @IsOptional()
  @IsString()
  motivationalMessage?: string;

  // شروط إضافية
  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;
}

// ═══════════════════════════════════════════════════════════
// تعديل قاعدة تنبيه
// ═══════════════════════════════════════════════════════════

export class UpdateNotificationRuleDto extends PartialType(CreateNotificationRuleDto) {}

// ═══════════════════════════════════════════════════════════
// تبديل حالة التفعيل
// ═══════════════════════════════════════════════════════════

export class ToggleRuleDto {
  @IsBoolean()
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════
// فلترة الإشعارات
// ═══════════════════════════════════════════════════════════

export class NotificationFilterDto {
  @IsOptional()
  @IsBoolean()
  isRead?: boolean;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  triggerEvent?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

// ═══════════════════════════════════════════════════════════
// تحديث قراءة الإشعار
// ═══════════════════════════════════════════════════════════

export class MarkNotificationsReadDto {
  @IsArray()
  @IsUUID('4', { each: true })
  notificationIds: string[];
}

// ═══════════════════════════════════════════════════════════
// اختبار قاعدة تنبيه (إرسال تجريبي)
// ═══════════════════════════════════════════════════════════

export class TestNotificationRuleDto {
  @IsUUID('4')
  ruleId: string;

  @IsOptional()
  @IsUUID('4')
  testEmployeeId?: string;
}

// ═══════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════

export class NotificationRuleResponseDto {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: NotificationTriggerEvent;
  channels: NotificationChannel[];
  recipientTypes: string[];
  specificEmployeeIds: string[] | null;
  targetRoles: string[] | null;
  customPhones: string[] | null;
  customEmails: string[] | null;
  dashboardTitle: string | null;
  dashboardTemplate: string | null;
  emailSubject: string | null;
  emailTemplate: string | null;
  whatsappTemplate: string | null;
  motivationalMessage: string | null;
  conditions: Record<string, unknown> | null;
  isActive: boolean;
  priority: number;
  sentCount: number;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationStatsResponseDto {
  totalRules: number;
  activeRules: number;
  totalSent: number;
  sentToday: number;
  byChannel: Record<string, number>;
  byEvent: Record<string, number>;
  failedCount: number;
}

/**
 * المتغيرات الديناميكية المتاحة للقوالب
 */
export const TEMPLATE_VARIABLES = {
  // بيانات الموظف
  '{اسم_الموظف}': 'اسم الموظف المستلم',
  '{بريد_الموظف}': 'بريد الموظف الإلكتروني',

  // بيانات الطلب
  '{رقم_الطلب}': 'رقم الطلب',
  '{رابط_الطلب}': 'رابط مباشر للطلب',
  '{مبلغ_الطلب}': 'المبلغ الإجمالي',
  '{حالة_الطلب}': 'حالة الطلب',
  '{طريقة_الدفع}': 'طريقة الدفع',

  // بيانات العميل
  '{اسم_العميل}': 'اسم العميل',
  '{هاتف_العميل}': 'رقم هاتف العميل',

  // بيانات المنتج
  '{اسم_المنتج}': 'اسم المنتج',
  '{كمية_المنتج}': 'الكمية المتبقية',

  // بيانات التقييم
  '{نص_التقييم}': 'نص التقييم',
  '{درجة_التقييم}': 'درجة التقييم (1-5)',

  // بيانات عامة
  '{اسم_المتجر}': 'اسم المتجر',
  '{التاريخ}': 'التاريخ الحالي',
  '{الوقت}': 'الوقت الحالي',
} as const;
