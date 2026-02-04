/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates DTOs                                   ║
 * ║  ✅ v2: type/channel اختياري + triggerEvent + بدون IsEnum                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsString, IsOptional, IsArray, IsObject, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Enums (للتوثيق فقط - لا تُستخدم في validation)
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
  ORDER_NOTIFICATIONS = 'order_notifications',
  SHIPPING_NOTIFICATIONS = 'shipping_notifications',
  SALES_RECOVERY = 'sales_recovery',
  ENGAGEMENT = 'engagement',
  SERVICE = 'service',
  GENERAL = 'general',
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
// Button Type
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
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: 'وصف القالب' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'نوع القالب', default: 'text' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'فئة القالب' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'القناة', default: 'whatsapp' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiProperty({ description: 'محتوى القالب' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content: string;

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

  @ApiPropertyOptional({ description: 'اللغة', default: 'ar' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'المتغيرات' })
  @IsOptional()
  @IsArray()
  variables?: string[];

  @ApiPropertyOptional({ description: 'الحالة' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'الحدث المرتبط مثل order.created' })
  @IsOptional()
  @IsString()
  triggerEvent?: string;

  @ApiPropertyOptional({ description: 'بيانات إضافية' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Template DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  header?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ type: [TemplateButton] })
  @IsOptional()
  @IsArray()
  buttons?: TemplateButton[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  triggerEvent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Template Filters DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class TemplateFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
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
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  name: string;

  @ApiProperty({ enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'] })
  @IsString()
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

  @ApiProperty({ default: 'ar' })
  @IsString()
  language: string;

  @ApiProperty()
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
  type: string;
  category: string;
  channel: string;
  content: string;
  header?: string;
  footer?: string;
  mediaUrl?: string;
  buttons?: TemplateButton[];
  status: string;
  language: string;
  usageCount: number;
  triggerEvent?: string;
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
