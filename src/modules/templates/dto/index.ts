/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates DTOs                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsString, IsOptional, IsEnum, IsArray, IsObject, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════════════════════════════════════════

export enum TemplateType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  INTERACTIVE = 'interactive',
  CAROUSEL = 'carousel',
}

export enum TemplateCategory {
  MARKETING = 'marketing',
  UTILITY = 'utility',
  AUTHENTICATION = 'authentication',
  ORDER_CONFIRMATION = 'order_confirmation',
  SHIPPING_UPDATE = 'shipping_update',
  ABANDONED_CART = 'abandoned_cart',
  REVIEW_REQUEST = 'review_request',
  WELCOME = 'welcome',
  SUPPORT = 'support',
  PROMOTION = 'promotion',
  COD_CONFIRMATION = 'cod_confirmation',
  PAYMENT_REMINDER = 'payment_reminder',
  PRODUCT_RESTOCK = 'product_restock',
}

export enum TemplateStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export enum TemplateChannel {
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
  EMAIL = 'email',
  TELEGRAM = 'telegram',
  INSTAGRAM = 'instagram',
}

// ═══════════════════════════════════════════════════════════════════════════════
// Button Types
// ═══════════════════════════════════════════════════════════════════════════════

export class TemplateButton {
  @ApiProperty({ enum: ['url', 'phone', 'quick_reply', 'copy_code'] })
  type: 'url' | 'phone' | 'quick_reply' | 'copy_code';

  @ApiProperty()
  text: string;

  @ApiPropertyOptional()
  url?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  payload?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Template DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateTemplateDto {
  @ApiProperty({ description: 'اسم القالب' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'وصف القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: TemplateType, description: 'نوع القالب' })
  @IsEnum(TemplateType)
  type: TemplateType;

  @ApiProperty({ enum: TemplateCategory, description: 'فئة القالب' })
  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @ApiProperty({ enum: TemplateChannel, description: 'القناة' })
  @IsEnum(TemplateChannel)
  channel: TemplateChannel;

  @ApiProperty({ description: 'محتوى القالب' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content: string;

  @ApiPropertyOptional({ description: 'عنوان القالب (للصور والفيديو)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  header?: string;

  @ApiPropertyOptional({ description: 'تذييل القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  @ApiPropertyOptional({ description: 'رابط الوسائط' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'أزرار تفاعلية', type: [TemplateButton] })
  @IsOptional()
  @IsArray()
  buttons?: TemplateButton[];

  @ApiPropertyOptional({ description: 'اللغة', default: 'ar' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'المتغيرات المطلوبة' })
  @IsOptional()
  @IsArray()
  variables?: string[];

  @ApiPropertyOptional({ description: 'بيانات إضافية' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Template DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateTemplateDto {
  @ApiPropertyOptional({ description: 'اسم القالب' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'وصف القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: TemplateCategory, description: 'فئة القالب' })
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @ApiPropertyOptional({ description: 'محتوى القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  content?: string;

  @ApiPropertyOptional({ description: 'عنوان القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  header?: string;

  @ApiPropertyOptional({ description: 'تذييل القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  @ApiPropertyOptional({ description: 'رابط الوسائط' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'أزرار تفاعلية', type: [TemplateButton] })
  @IsOptional()
  @IsArray()
  buttons?: TemplateButton[];

  @ApiPropertyOptional({ enum: TemplateStatus, description: 'حالة القالب' })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional({ description: 'بيانات إضافية' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Template Filters DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class TemplateFiltersDto {
  @ApiPropertyOptional({ enum: TemplateType })
  @IsOptional()
  @IsEnum(TemplateType)
  type?: TemplateType;

  @ApiPropertyOptional({ enum: TemplateCategory })
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @ApiPropertyOptional({ enum: TemplateStatus })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional({ enum: TemplateChannel })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Submit WhatsApp Template DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class SubmitWhatsAppTemplateDto {
  @ApiProperty({ description: 'اسم القالب (باللاتينية، بدون مسافات)' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  name: string;

  @ApiProperty({ enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'] })
  @IsString()
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

  @ApiProperty({ description: 'كود اللغة', default: 'ar' })
  @IsString()
  language: string;

  @ApiProperty({ description: 'مكونات القالب' })
  @IsArray()
  components: Array<{
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
    format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
    text?: string;
    example?: {
      header_text?: string[];
      body_text?: string[][];
    };
    buttons?: Array<{
      type: 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY' | 'COPY_CODE';
      text: string;
      url?: string;
      phone_number?: string;
    }>;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class TemplateResponseDto {
  id: string;
  name: string;
  description?: string;
  type: TemplateType;
  category: TemplateCategory;
  channel: TemplateChannel;
  content: string;
  header?: string;
  footer?: string;
  mediaUrl?: string;
  buttons?: TemplateButton[];
  status: TemplateStatus;
  language: string;
  usageCount: number;
  whatsappTemplateId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class TemplateStatsDto {
  usageCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  clickCount: number;
  deliveryRate: number;
  readRate: number;
  clickRate: number;
  lastUsed?: Date;
}
