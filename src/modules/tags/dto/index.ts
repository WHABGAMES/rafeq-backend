/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tags DTOs                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Create Tag DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class CreateTagDto {
  @ApiProperty({ description: 'اسم التصنيف' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: 'اللون (HEX)', example: '#FF5722' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'اللون يجب أن يكون بصيغة HEX' })
  color?: string;

  @ApiPropertyOptional({ description: 'الوصف' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({
    description: 'نوع التصنيف',
    enum: ['conversation', 'contact', 'both'],
  })
  @IsOptional()
  @IsEnum(['conversation', 'contact', 'both'])
  type?: 'conversation' | 'contact' | 'both';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Update Tag DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateTagDto {
  @ApiPropertyOptional({ description: 'اسم التصنيف' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ description: 'اللون (HEX)' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;

  @ApiPropertyOptional({ description: 'الوصف' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({
    description: 'نوع التصنيف',
    enum: ['conversation', 'contact', 'both'],
  })
  @IsOptional()
  @IsEnum(['conversation', 'contact', 'both'])
  type?: 'conversation' | 'contact' | 'both';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Response DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class TagResponseDto {
  id: string;
  name: string;
  color: string;
  description?: string;
  type: 'conversation' | 'contact' | 'both';
  conversationCount: number;
  contactCount: number;
  createdAt: Date;
  updatedAt: Date;
}
