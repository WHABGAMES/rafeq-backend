/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Billing DTOs                               ║
 * ║                                                                                ║
 * ║  📌 Data Transfer Objects لوحدة الفوترة                                        ║
 * ║                                                                                ║
 * ║  الغرض:                                                                        ║
 * ║  - التحقق من صحة البيانات الواردة                                              ║
 * ║  - تحويل البيانات بين الطبقات                                                  ║
 * ║  - توثيق API تلقائياً (Swagger)                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsUUID,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsNumber,
  ValidateNested,
  Min,
  Max,
  IsEmail,
  IsArray,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

// Enums from entities
import { BillingInterval, PaymentProvider } from '@database/entities/subscription.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 BILLING INFO DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class BillingInfoDto {
  @ApiPropertyOptional({
    description: 'اسم الشركة للفاتورة',
    example: 'شركة الابتكار التقني',
  })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  companyName?: string;

  @ApiPropertyOptional({
    description: 'الرقم الضريبي',
    example: '300000000000003',
  })
  @IsOptional()
  @IsString()
  @Length(5, 50)
  taxNumber?: string;

  @ApiPropertyOptional({
    description: 'البريد الإلكتروني للفواتير',
    example: 'billing@example.com',
  })
  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @ApiPropertyOptional({
    description: 'العنوان',
    example: 'الرياض، حي العليا',
  })
  @IsOptional()
  @IsString()
  @Length(5, 200)
  address?: string;

  @ApiPropertyOptional({
    description: 'المدينة',
    example: 'الرياض',
  })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  city?: string;

  @ApiPropertyOptional({
    description: 'الدولة',
    example: 'SA',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ➕ CREATE SUBSCRIPTION DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 📝 CreateSubscriptionDto
 * 
 * بيانات إنشاء اشتراك جديد
 * 
 * @example
 * {
 *   "tenantId": "uuid",
 *   "planId": "uuid",
 *   "billingInterval": "monthly",
 *   "paymentProvider": "stripe"
 * }
 */
export class CreateSubscriptionDto {
  @ApiProperty({
    description: 'معرف المستأجر',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  tenantId: string;

  @ApiProperty({
    description: 'معرف خطة الاشتراك',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  planId: string;

  @ApiProperty({
    description: 'فترة الفوترة',
    enum: BillingInterval,
    example: BillingInterval.MONTHLY,
  })
  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @ApiPropertyOptional({
    description: 'مزود الدفع',
    enum: PaymentProvider,
    default: PaymentProvider.STRIPE,
  })
  @IsOptional()
  @IsEnum(PaymentProvider)
  paymentProvider?: PaymentProvider;

  @ApiPropertyOptional({
    description: 'بيانات الفوترة',
    type: BillingInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingInfoDto)
  billingInfo?: BillingInfoDto;

  @ApiPropertyOptional({
    description: 'كود الخصم (كوبون)',
    example: 'WELCOME50',
  })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  couponCode?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✏️ UPDATE SUBSCRIPTION DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({
    description: 'التجديد التلقائي',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({
    description: 'بيانات الفوترة',
    type: BillingInfoDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingInfoDto)
  billingInfo?: BillingInfoDto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 CHANGE PLAN DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 📝 ChangeSubscriptionPlanDto
 * 
 * بيانات تغيير خطة الاشتراك
 */
export class ChangeSubscriptionPlanDto {
  @ApiProperty({
    description: 'معرف الخطة الجديدة',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsUUID()
  newPlanId: string;

  @ApiPropertyOptional({
    description: 'تغيير فترة الفوترة أيضاً',
    enum: BillingInterval,
  })
  @IsOptional()
  @IsEnum(BillingInterval)
  newBillingInterval?: BillingInterval;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ❌ CANCEL SUBSCRIPTION DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 📝 CancelSubscriptionDto
 * 
 * بيانات إلغاء الاشتراك
 */
export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    description: 'سبب الإلغاء',
    enum: [
      'too_expensive',
      'not_using',
      'missing_features',
      'switching_competitor',
      'closing_business',
      'other',
    ],
    example: 'not_using',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'ملاحظات إضافية',
    example: 'لم نعد نحتاج الخدمة حالياً',
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  feedback?: string;

  @ApiPropertyOptional({
    description: 'إلغاء فوري (بدون انتظار نهاية الفترة)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 💳 PAYMENT METHOD DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class AddPaymentMethodDto {
  @ApiProperty({
    description: 'نوع وسيلة الدفع',
    enum: ['card', 'bank_transfer', 'mada'],
    example: 'card',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'معرف وسيلة الدفع من مزود الدفع (Stripe payment_method_id)',
    example: 'pm_1234567890',
  })
  @IsString()
  paymentMethodId: string;

  @ApiPropertyOptional({
    description: 'تعيين كوسيلة دفع افتراضية',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  setAsDefault?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 SUBSCRIPTION PLAN DTOs
// ═══════════════════════════════════════════════════════════════════════════════

class PlanLimitsDto {
  @ApiProperty({ description: 'عدد الرسائل الشهرية', example: 1000 })
  @IsNumber()
  @Min(-1)  // -1 = unlimited
  messagesPerMonth: number;

  @ApiProperty({ description: 'عدد المتاجر', example: 3 })
  @IsNumber()
  @Min(-1)
  stores: number;

  @ApiProperty({ description: 'عدد المستخدمين', example: 5 })
  @IsNumber()
  @Min(-1)
  usersPerTenant: number;

  @ApiProperty({ description: 'عدد القنوات لكل متجر', example: 3 })
  @IsNumber()
  @Min(-1)
  channelsPerStore: number;

  @ApiProperty({ description: 'عدد الحملات الشهرية', example: 10 })
  @IsNumber()
  @Min(-1)
  campaignsPerMonth: number;

  @ApiProperty({ description: 'عدد القوالب', example: 20 })
  @IsNumber()
  @Min(-1)
  templates: number;

  @ApiProperty({ description: 'مساحة التخزين بالجيجابايت', example: 1 })
  @IsNumber()
  @Min(0)
  storageGb: number;
}

class PlanFeaturesDto {
  @ApiProperty({ description: 'ميزات الذكاء الاصطناعي', example: true })
  @IsBoolean()
  aiFeatures: boolean;

  @ApiProperty({ description: 'التحليلات المتقدمة', example: true })
  @IsBoolean()
  advancedAnalytics: boolean;

  @ApiProperty({ description: 'الوصول للـ API', example: true })
  @IsBoolean()
  apiAccess: boolean;

  @ApiProperty({ description: 'Webhooks مخصصة', example: true })
  @IsBoolean()
  webhooks: boolean;

  @ApiProperty({ description: 'تصدير البيانات', example: true })
  @IsBoolean()
  dataExport: boolean;

  @ApiProperty({ description: 'دعم ذو أولوية', example: false })
  @IsBoolean()
  prioritySupport: boolean;
}

class PlanPricingDto {
  @ApiProperty({ description: 'العملة', example: 'SAR' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ description: 'السعر الشهري', example: 99 })
  @IsNumber()
  @Min(0)
  monthly: number;

  @ApiPropertyOptional({ description: 'السعر السنوي', example: 990 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  yearly?: number;
}

/**
 * 📝 CreateSubscriptionPlanDto
 * 
 * بيانات إنشاء خطة اشتراك جديدة (للمشرفين فقط)
 */
export class CreateSubscriptionPlanDto {
  @ApiProperty({
    description: 'اسم الخطة (للنظام)',
    example: 'growth',
  })
  @IsString()
  @Length(2, 50)
  name: string;

  @ApiProperty({
    description: 'الاسم المعروض',
    example: 'خطة النمو',
  })
  @IsString()
  @Length(2, 100)
  displayName: string;

  @ApiPropertyOptional({
    description: 'وصف الخطة',
    example: 'مثالية للمتاجر النامية',
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiProperty({
    description: 'نوع الخطة',
    enum: ['free', 'paid', 'trial', 'custom'],
    example: 'paid',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'التسعير',
    type: PlanPricingDto,
  })
  @ValidateNested()
  @Type(() => PlanPricingDto)
  pricing: PlanPricingDto;

  @ApiProperty({
    description: 'الحدود',
    type: PlanLimitsDto,
  })
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits: PlanLimitsDto;

  @ApiProperty({
    description: 'الميزات',
    type: PlanFeaturesDto,
  })
  @ValidateNested()
  @Type(() => PlanFeaturesDto)
  features: PlanFeaturesDto;

  @ApiPropertyOptional({
    description: 'قائمة الميزات للعرض',
    example: ['1000 رسالة شهرياً', '3 متاجر', 'دعم عبر البريد'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featureList?: string[];

  @ApiPropertyOptional({
    description: 'أيام التجربة المجانية',
    example: 14,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(90)
  trialDays?: number;
}

/**
 * 📝 UpdateSubscriptionPlanDto
 * 
 * تحديث خطة اشتراك (جزئي)
 */
export class UpdateSubscriptionPlanDto extends PartialType(CreateSubscriptionPlanDto) {}

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 RESPONSE DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class UsageStatsResponseDto {
  @ApiProperty({ description: 'الاستخدام الحالي' })
  usage: Record<string, number>;

  @ApiProperty({ description: 'الحدود القصوى' })
  limits: Record<string, number>;

  @ApiProperty({ description: 'النسب المئوية' })
  percentages: Record<string, number>;
}

export class SubscriptionResponseDto {
  @ApiProperty({ description: 'معرف الاشتراك' })
  id: string;

  @ApiProperty({ description: 'حالة الاشتراك' })
  status: string;

  @ApiProperty({ description: 'اسم الخطة' })
  planName: string;

  @ApiProperty({ description: 'تاريخ البدء' })
  startedAt: Date;

  @ApiProperty({ description: 'تاريخ انتهاء الفترة الحالية' })
  currentPeriodEnd: Date;

  @ApiProperty({ description: 'التجديد التلقائي' })
  autoRenew: boolean;

  @ApiProperty({ description: 'إحصائيات الاستخدام', type: UsageStatsResponseDto })
  usage: UsageStatsResponseDto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📤 EXPORTS INDEX
// ═══════════════════════════════════════════════════════════════════════════════

// All DTOs are exported above - no separate files needed
