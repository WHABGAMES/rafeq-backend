/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Replies DTOs                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Create Quick Reply DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateQuickReplyDto {
  @ApiProperty({ description: 'الاختصار (يبدأ بـ /)', example: '/hello' })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^\/[a-zA-Z0-9_-]+$/, {
    message: 'الاختصار يجب أن يبدأ بـ / ويحتوي على أحرف وأرقام فقط',
  })
  shortcut: string;

  @ApiProperty({ description: 'عنوان الرد' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title: string;

  @ApiProperty({ description: 'محتوى الرد' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({ description: 'الفئة' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'المرفقات' })
  @IsOptional()
  @IsArray()
  attachments?: Array<{
    type: 'image' | 'video' | 'document';
    url: string;
    name?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Quick Reply DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateQuickReplyDto {
  @ApiPropertyOptional({ description: 'الاختصار' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^\/[a-zA-Z0-9_-]+$/)
  shortcut?: string;

  @ApiPropertyOptional({ description: 'عنوان الرد' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ description: 'محتوى الرد' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional({ description: 'الفئة' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'المرفقات' })
  @IsOptional()
  @IsArray()
  attachments?: Array<{
    type: 'image' | 'video' | 'document';
    url: string;
    name?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class QuickReplyResponseDto {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string;
  variables?: string[];
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
  }>;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
