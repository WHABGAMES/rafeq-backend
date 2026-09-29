import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OtpPlatform } from '../entities/otp-config.entity';

/** Runtime-validated inputs accepted by the tenant OTP configuration endpoints. */
export class CreateOtpRelayConfigDto {
  @IsString() @IsNotEmpty() @MaxLength(100) slug: string;
  @IsOptional() @IsEnum(OtpPlatform) platform?: OtpPlatform;

  @IsOptional() @IsString() @MaxLength(255) pageTitle?: string;
  @IsOptional() @IsString() pageSubtitle?: string;
  @IsOptional() @IsString() @MaxLength(2_000) logoUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(40) @Max(200) logoSize?: number;
  @IsOptional() @IsString() @MaxLength(50) bgColor?: string;
  @IsOptional() @IsString() @MaxLength(50) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(50) cardColor?: string;
  @IsOptional() @IsString() @MaxLength(50) textColor?: string;
  @IsOptional() @IsString() @MaxLength(50) secondaryTextColor?: string;
  @IsOptional() @IsString() @MaxLength(2_000) bgImageUrl?: string;
  @IsOptional() @IsString() successMsg?: string;
  @IsOptional() @IsString() noCodeMsg?: string;
  @IsOptional() @IsBoolean() needsUsername?: boolean;
  @IsOptional() @IsString() @MaxLength(255) usernameLabel?: string;
  @IsOptional() @IsString() @MaxLength(255) orderLabel?: string;
  @IsOptional() @IsString() @MaxLength(255) buttonText?: string;
  @IsOptional() @IsString() @MaxLength(255) footerText?: string;
  @IsOptional() @IsBoolean() showRafeqBadge?: boolean;

  @IsOptional() @IsString() @MaxLength(255) emailHost?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65_535) emailPort?: number;
  @IsOptional() @IsString() @MaxLength(255) emailUser?: string;
  @IsOptional() @IsString() @MaxLength(1_000) emailPassword?: string;
  @IsOptional() @IsBoolean() emailTls?: boolean;
  @IsOptional() @IsString() @MaxLength(255) senderFilter?: string;
  @IsOptional() @IsString() @MaxLength(500) otpRegex?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) otpLength?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) freshnessMinutes?: number;
  @IsOptional() @IsString() @MaxLength(500) usernameRegex?: string;

  @IsOptional() @IsBoolean() verifyOrder?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) rateLimit?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() notifyEmployees?: boolean;
  @IsOptional() @IsString() employeePhones?: string;
  @IsOptional() @IsString() employeeEmails?: string;
  @IsOptional() @IsString() employeeMsgTemplate?: string;
  @IsOptional() @IsBoolean() sendCodeToCustomer?: boolean;
  @IsOptional() @IsString() customerMsgTemplate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxCodesPerOrder?: number;
  @IsOptional() @IsEnum(['email', 'telegram_bot']) otpMethod?: 'email' | 'telegram_bot';
  @IsOptional() @IsString() @MaxLength(50) telegramBotFlowId?: string;

  @IsOptional() @IsString() @MaxLength(20) supportWhatsapp?: string;
  @IsOptional() @IsString() @MaxLength(255) supportDiscord?: string;
  @IsOptional() @IsString() @MaxLength(100) supportInstagram?: string;
  @IsOptional() @IsString() @MaxLength(100) supportTiktok?: string;
  @IsOptional() @IsString() @MaxLength(100) supportTwitter?: string;

  @IsOptional() @IsBoolean() compensationEnabled?: boolean;
  @IsOptional() @IsEnum(['manual', 'auto']) compensationMethod?: 'manual' | 'auto';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxCompensationsPerOrder?: number;
  @IsOptional() @IsString() @MaxLength(100) compensationButtonText?: string;
  @IsOptional() @IsString() compensationSuccessMsg?: string;
  @IsOptional() @IsString() compensationEmptyMsg?: string;
  @IsOptional() @IsString() compensationLimitMsg?: string;
  @IsOptional() @IsBoolean() compensationNotifyEmployee?: boolean;
  @IsOptional() @IsString() compensationEmployeeTemplate?: string;
  @IsOptional() @IsBoolean() compensationNotifyCustomer?: boolean;
  @IsOptional() @IsString() compensationCustomerTemplate?: string;
}

export class UpdateOtpRelayConfigDto extends PartialType(CreateOtpRelayConfigDto) {}

export class AddOtpInventoryItemDto {
  @IsString() @IsNotEmpty() accountData: string;
  @IsOptional() @IsString() @MaxLength(255) accountLabel?: string;
  @IsOptional() @IsString() notes?: string;
}

export class BulkAddOtpInventoryDto {
  @IsString() @IsNotEmpty() accounts: string;
  @IsOptional() @IsString() @MaxLength(255) accountLabel?: string;
}

export class VerifyOtpRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(255) orderNumber: string;
  @IsString() @IsNotEmpty() @MaxLength(255) username: string;
}

export class RequestOtpCompensationDto {
  @IsString() @IsNotEmpty() @MaxLength(255) orderNumber: string;
  @IsOptional() @IsString() @MaxLength(255) username?: string;
  @IsOptional() @IsString() @MaxLength(1_000) reason?: string;
}
