import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WhatsappProvider } from '../entities/whatsapp-settings.entity';

export class SaveAdminWhatsappSettingsDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneNumber must use international E.164 format',
  })
  phoneNumber: string;

  @IsEnum(WhatsappProvider)
  provider: WhatsappProvider;

  /** Omit on updates to preserve the encrypted token already stored. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(4_096)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  webhookVerifyToken?: string;
}

export class ToggleAdminWhatsappDto {
  @IsBoolean()
  isActive: boolean;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class TestAdminWhatsappDto {
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneNumber must use international E.164 format',
  })
  phoneNumber: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
