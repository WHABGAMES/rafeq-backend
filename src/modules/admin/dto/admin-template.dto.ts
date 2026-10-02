import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MessageChannel, MessageLanguage, TriggerEvent } from '../entities/message-template.entity';

export class CreateAdminTemplateDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsEnum(TriggerEvent)
  triggerEvent: TriggerEvent;

  @IsEnum(MessageChannel)
  channel: MessageChannel;

  @IsEnum(MessageLanguage)
  language: MessageLanguage;

  @IsString()
  @MaxLength(20_000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAdminTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(TriggerEvent)
  triggerEvent?: TriggerEvent;

  @IsOptional()
  @IsEnum(MessageChannel)
  channel?: MessageChannel;

  @IsOptional()
  @IsEnum(MessageLanguage)
  language?: MessageLanguage;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PreviewAdminTemplateDto {
  @IsString()
  @MaxLength(20_000)
  content: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

export class TestAdminTemplateDto {
  @IsUUID()
  templateId: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'recipientPhone must use international E.164 format',
  })
  recipientPhone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  recipientEmail?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsUUID()
  recipientUserId?: string;
}

export class BulkToggleAdminTemplatesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids: string[];

  @IsBoolean()
  isActive: boolean;
}
