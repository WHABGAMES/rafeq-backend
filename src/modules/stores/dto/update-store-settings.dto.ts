/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Store DTOs                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsObject, IsString, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO لتحديث إعدادات المتجر
 */
export class UpdateStoreSettingsDto {
  @ApiProperty({
    description: 'الإعدادات الجديدة',
    type: 'object',
    example: {
      autoReply: true,
      welcomeMessageEnabled: true,
      orderNotificationsEnabled: true,
    },
  })
  @IsObject()
  settings: Record<string, unknown>;
}

/**
 * DTO لتحديث الأحداث المشترك فيها
 */
export class UpdateSubscribedEventsDto {
  @ApiProperty({
    description: 'قائمة الأحداث',
    example: ['order.created', 'customer.created', 'abandoned.cart'],
  })
  @IsArray()
  @IsString({ each: true })
  events: string[];
}

/**
 * DTO للرد على قائمة المتاجر
 */
export class StoreResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  platform: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  sallaStoreName?: string;

  @ApiPropertyOptional()
  sallaDomain?: string;

  @ApiPropertyOptional()
  sallaAvatar?: string;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional()
  lastSyncedAt?: Date;

  @ApiProperty()
  createdAt: Date;
}
