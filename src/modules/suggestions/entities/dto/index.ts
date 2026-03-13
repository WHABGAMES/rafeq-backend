/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestions DTOs                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuggestionType, SuggestionStatus } from '../entities/suggestion.entity';

// ═══════════════════════════════════════════════════════════
// Create Suggestion
// ═══════════════════════════════════════════════════════════

export class CreateSuggestionDto {
  @ApiProperty({ description: 'عنوان الاقتراح', example: 'إضافة إشعارات واتساب للطلبات' })
  @IsString()
  @MinLength(5, { message: 'العنوان يجب أن يكون 5 أحرف على الأقل' })
  @MaxLength(300, { message: 'العنوان يجب أن لا يتجاوز 300 حرف' })
  title: string;

  @ApiProperty({ description: 'تفاصيل الاقتراح' })
  @IsString()
  @MinLength(10, { message: 'الوصف يجب أن يكون 10 أحرف على الأقل' })
  @MaxLength(5000, { message: 'الوصف يجب أن لا يتجاوز 5000 حرف' })
  description: string;

  @ApiProperty({ enum: SuggestionType, description: 'نوع الطلب' })
  @IsEnum(SuggestionType)
  type: SuggestionType;

  @ApiPropertyOptional({ description: 'نشر بشكل مجهول', default: false })
  @IsBoolean()
  @IsOptional()
  isAnonymous?: boolean;
}

// ═══════════════════════════════════════════════════════════
// Create Comment
// ═══════════════════════════════════════════════════════════

export class CreateCommentDto {
  @ApiProperty({ description: 'نص التعليق' })
  @IsString()
  @MinLength(2, { message: 'التعليق يجب أن يكون حرفين على الأقل' })
  @MaxLength(2000, { message: 'التعليق يجب أن لا يتجاوز 2000 حرف' })
  comment: string;

  @ApiPropertyOptional({ description: 'تعليق مجهول', default: false })
  @IsBoolean()
  @IsOptional()
  isAnonymous?: boolean;
}

// ═══════════════════════════════════════════════════════════
// Admin: Create Comment (official reply)
// ═══════════════════════════════════════════════════════════

export class AdminCreateCommentDto {
  @ApiProperty({ description: 'نص الرد الرسمي' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  comment: string;
}

// ═══════════════════════════════════════════════════════════
// Admin: Update Status
// ═══════════════════════════════════════════════════════════

export class UpdateSuggestionStatusDto {
  @ApiProperty({ enum: SuggestionStatus, description: 'الحالة الجديدة' })
  @IsEnum(SuggestionStatus)
  status: SuggestionStatus;
}

// ═══════════════════════════════════════════════════════════
// Admin: Merge Suggestions
// ═══════════════════════════════════════════════════════════

export class MergeSuggestionsDto {
  @ApiProperty({ description: 'ID الاقتراح المصدر (سيُدمج في الهدف)' })
  @IsUUID()
  sourceId: string;

  @ApiProperty({ description: 'ID الاقتراح الهدف (سيحصل على الأصوات)' })
  @IsUUID()
  targetId: string;
}

// ═══════════════════════════════════════════════════════════
// Query Params
// ═══════════════════════════════════════════════════════════

export class ListSuggestionsQueryDto {
  @IsOptional()
  @IsEnum(SuggestionType)
  type?: SuggestionType;

  @IsOptional()
  @IsEnum(SuggestionStatus)
  status?: SuggestionStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsString()
  sort?: 'popular' | 'recent' | 'most_commented';
}
