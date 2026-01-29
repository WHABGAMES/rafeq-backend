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
  IsEnum,
  IsEmail,
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

export class HolidayDto {
  @ApiProperty({ example: '2024-01-01' })
  @IsString()
  date: string;

  @ApiProperty({ example: 'رأس السنة' })
  @IsString()
  name: string;
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

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  sunday?: DayScheduleDto;

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  monday?: DayScheduleDto;

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  tuesday?: DayScheduleDto;

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  wednesday?: DayScheduleDto;

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  thursday?: DayScheduleDto;

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  friday?: DayScheduleDto;

  @ApiPropertyOptional({ type: DayScheduleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DayScheduleDto)
  saturday?: DayScheduleDto;

  @ApiPropertyOptional({ type: [HolidayDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HolidayDto)
  holidays?: HolidayDto[];
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

export class UpdateAutoRepliesDto {
  @ApiPropertyOptional({ example: 'مرحباً! كيف يمكنني مساعدتك؟' })
  @IsOptional()
  @IsString()
  welcomeMessage?: string;

  @ApiPropertyOptional({ example: 'نحن غير متاحين حالياً' })
  @IsOptional()
  @IsString()
  awayMessage?: string;

  @ApiPropertyOptional({ example: 'المتجر مغلق الآن. ساعات العمل من 9 صباحاً حتى 5 مساءً' })
  @IsOptional()
  @IsString()
  closedMessage?: string;

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

// ═══════════════════════════════════════════════════════════════════════════════
// Export All
// ═══════════════════════════════════════════════════════════════════════════════

export * from './index';
