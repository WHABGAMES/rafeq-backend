import { IsArray, IsEnum, IsNotEmpty, IsString, ArrayMaxSize, MaxLength } from 'class-validator';
import { ConversationStatus } from '@database/entities';

export class SendAdminMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  content: string;
}

export class UpdateAdminConversationStatusDto {
  @IsEnum(ConversationStatus)
  status: ConversationStatus;
}

export class UpdateAdminConversationTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags: string[];
}
