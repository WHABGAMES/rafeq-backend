/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Conversion Elements DTOs                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEnum, IsOptional, IsObject, IsUUID, IsNumber,
  IsArray, ValidateNested, IsDateString, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ElementType, ElementStatus, ElementPosition,
  ElementContent, ElementDesign, ElementBehavior, ElementTargeting,
} from '../entities/conversion-element.entity';

// ─── Create Element ─────────────────────────────────────────────
export class CreateElementDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: ElementType })
  @IsEnum(ElementType)
  type: ElementType;

  @ApiPropertyOptional({ enum: ElementPosition })
  @IsOptional()
  @IsEnum(ElementPosition)
  position?: ElementPosition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  content?: ElementContent;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  design?: ElementDesign;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  behavior?: ElementBehavior;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  targeting?: ElementTargeting;
}

// ─── Update Element ─────────────────────────────────────────────
export class UpdateElementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ElementStatus })
  @IsOptional()
  @IsEnum(ElementStatus)
  status?: ElementStatus;

  @ApiPropertyOptional({ enum: ElementPosition })
  @IsOptional()
  @IsEnum(ElementPosition)
  position?: ElementPosition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  content?: ElementContent;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  design?: ElementDesign;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  behavior?: ElementBehavior;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  targeting?: ElementTargeting;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

// ─── Track Event ────────────────────────────────────────────────
export class TrackEventDto {
  @ApiProperty()
  @IsString()
  eventType: string;

  @ApiProperty()
  @IsUUID()
  elementId: string;

  @ApiProperty()
  @IsString()
  sessionId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  visitorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pageType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cartValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cartItems?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  orderValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmMedium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variantLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

// ─── Batch Track Events ─────────────────────────────────────────
export class BatchTrackDto {
  @ApiProperty({ type: [TrackEventDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events: TrackEventDto[];
}

// ─── Analytics Query ────────────────────────────────────────────
export class AnalyticsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  elementId?: string;

  @ApiPropertyOptional({ enum: ElementType })
  @IsOptional()
  @IsEnum(ElementType)
  elementType?: ElementType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  groupBy?: 'day' | 'week' | 'month' | 'element' | 'type';
}

// ─── Create A/B Test ────────────────────────────────────────────
export class CreateABTestDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsUUID()
  elementAId: string;

  @ApiProperty()
  @IsUUID()
  elementBId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(90)
  trafficSplit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(50)
  minViewsPerVariant?: number;
}
