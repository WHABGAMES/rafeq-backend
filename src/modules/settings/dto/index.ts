/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Settings DTOs                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════════════════════
// General Settings
// ═══════════════════════════════════════════════════════════════════════════════

export class UpdateGeneralSettingsDto {
  @ApiPropertyOptional({ example: 'متجري' })
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiPropertyOptional({ example: 'https://mystore.com' })
  @IsOptional()
  @IsString()
  storeUrl?: string;

  @ApiPropertyOptional({ example: 'Asia/Riyadh' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'ar', enum: ['ar', 'en'] })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ example: 'SAR', enum: ['SAR', 'USD', 'AED', 'KWD'] })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'https://mystore.com/logo.png' })
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional({ example: 'DD/MM/YYYY' })
  @IsOptional()
  @IsString()
  dateFormat?: string;

  @ApiPropertyOptional({ example: 'HH:mm' })
  @IsOptional()
  @IsString()
  timeFormat?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  autoShortenLinks?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Notification Settings
// ═══════════════════════════════════════════════════════════════════════════════

export class EmailNotificationSettingsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newConversation?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newMessage?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  dailyReport?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  weeklyReport?: boolean;
}

export class PushNotificationSettingsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newConversation?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newMessage?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  mentions?: boolean;
}

export class SoundSettingsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 50, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  volume?: number;
}

export class UpdateNotificationSettingsDto {
  @ApiPropertyOptional({ type: EmailNotificationSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailNotificationSettingsDto)
  email?: EmailNotificationSettingsDto;

  @ApiPropertyOptional({ type: PushNotificationSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PushNotificationSettingsDto)
  push?: PushNotificationSettingsDto;

  @ApiPropertyOptional({ type: SoundSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SoundSettingsDto)
  sound?: SoundSettingsDto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Working Hours Settings
// ═══════════════════════════════════════════════════════════════════════════════

export class DayScheduleDto {
  @ApiProperty({ example: 'sunday', enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] })
  @IsString()
  @IsIn(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
  day: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: '09:00' })
  @IsString()
  start: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  end: string;
}

export class UpdateWorkingHoursDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'Asia/Riyadh' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ type: [DayScheduleDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayScheduleDto)
  schedule?: DayScheduleDto[];

  @ApiPropertyOptional({ type: [String], example: ['2026-09-23'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  holidays?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auto Reply Settings
// ═══════════════════════════════════════════════════════════════════════════════

export class DelayedResponseDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  delayMinutes?: number;

  @ApiPropertyOptional({ example: 'سنرد عليك قريباً' })
  @IsOptional()
  @IsString()
  message?: string;
}

export class AutoReplyMessageDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'سنرد عليك قريباً' })
  @IsOptional()
  @IsString()
  message?: string;
}

export class UpdateAutoRepliesDto {
  @ApiPropertyOptional({ type: AutoReplyMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoReplyMessageDto)
  welcomeMessage?: AutoReplyMessageDto;

  @ApiPropertyOptional({ type: AutoReplyMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoReplyMessageDto)
  awayMessage?: AutoReplyMessageDto;

  @ApiPropertyOptional({ type: AutoReplyMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoReplyMessageDto)
  closedMessage?: AutoReplyMessageDto;

  @ApiPropertyOptional({ type: DelayedResponseDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DelayedResponseDto)
  delayedResponse?: DelayedResponseDto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Team Settings
// ═══════════════════════════════════════════════════════════════════════════════

export class AutoAssignmentSettingsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'round_robin', enum: ['round_robin', 'load_balanced', 'manual'] })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  maxConversationsPerAgent?: number;
}

export class UpdateTeamSettingsDto {
  @ApiPropertyOptional({ type: AutoAssignmentSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoAssignmentSettingsDto)
  autoAssignment?: AutoAssignmentSettingsDto;

  @ApiPropertyOptional({ example: 300, description: 'Idle timeout in seconds' })
  @IsOptional()
  @IsNumber()
  idleTimeout?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  allowAgentTakeOver?: boolean;
}
