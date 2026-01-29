/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - CSAT DTOs                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Update CSAT Settings DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateCsatSettingsDto {
  @ApiPropertyOptional({ description: 'تفعيل نظام التقييم' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ['csat', 'nps', 'ces', 'thumbs'] })
  @IsOptional()
  @IsString()
  type?: 'csat' | 'nps' | 'ces' | 'thumbs';

  @ApiPropertyOptional({ description: 'السؤال (إنجليزي)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  question?: string;

  @ApiPropertyOptional({ description: 'السؤال (عربي)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  questionAr?: string;

  @ApiPropertyOptional({ enum: ['conversation_closed', 'agent_reply', 'delay'] })
  @IsOptional()
  @IsString()
  showAfter?: 'conversation_closed' | 'agent_reply' | 'delay';

  @ApiPropertyOptional({ description: 'التأخير بالدقائق' })
  @IsOptional()
  @IsNumber()
  delay?: number;

  @ApiPropertyOptional({ description: 'تفعيل سؤال المتابعة' })
  @IsOptional()
  @IsBoolean()
  followUpEnabled?: boolean;

  @ApiPropertyOptional({ description: 'سؤال المتابعة' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  followUpQuestion?: string;

  @ApiPropertyOptional({ description: 'القنوات المفعلة' })
  @IsOptional()
  @IsArray()
  channels?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Submit CSAT DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class SubmitCsatDto {
  @ApiPropertyOptional({ enum: ['csat', 'nps', 'ces', 'thumbs'] })
  @IsOptional()
  @IsString()
  type?: 'csat' | 'nps' | 'ces' | 'thumbs';

  @ApiProperty({ description: 'التقييم', minimum: 1, maximum: 10 })
  @IsNumber()
  @Min(1)
  @Max(10)
  rating: number;

  @ApiPropertyOptional({ description: 'ملاحظات إضافية' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class CsatSurveyResponseDto {
  id: string;
  conversationId: string;
  customerId: string;
  agentId?: string;
  type: string;
  rating: number;
  feedback?: string;
  createdAt: Date;
}

export class CsatAnalyticsDto {
  summary: {
    totalSurveys: number;
    averageRating: number;
    responseRate: number;
    satisfiedCustomers: number;
    unsatisfiedCustomers: number;
  };
  distribution: Array<{
    rating: number;
    count: number;
    percentage: number;
  }>;
  period: string;
}
