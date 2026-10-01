import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import {
  PlatformNotificationColor,
  PlatformNotificationDisplay,
  PlatformNotificationType,
} from '../platform-notification.entity';

export class CreatePlatformNotificationDto {
  @IsOptional()
  @IsEnum(PlatformNotificationType)
  type?: PlatformNotificationType;

  @IsEnum(PlatformNotificationDisplay)
  displayType: PlatformNotificationDisplay;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^(?:\/(?!\/)|https:\/\/)/i, { message: 'link must be an internal path or an HTTPS URL' })
  link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  linkLabel?: string;

  @IsOptional()
  @IsEnum(PlatformNotificationColor)
  colorScheme?: PlatformNotificationColor;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bgColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  textColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  isScrolling?: boolean;

  @IsOptional()
  @IsBoolean()
  isDismissible?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetPlans?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  showOnPages?: string[];

  @IsOptional()
  @IsBoolean()
  showOnLogin?: boolean;

  @IsOptional()
  @Type(() => Date)
  startsAt?: Date;

  @IsOptional()
  @Type(() => Date)
  endsAt?: Date;

  @IsOptional()
  @IsInt()
  @Min(0)
  repeatHours?: number | null;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlatformNotificationDto extends PartialType(CreatePlatformNotificationDto) {}
