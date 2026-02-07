/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - API Connect DTO                            ║
 * ║                                                                                ║
 * ║  DTO للربط عبر API Key بدلاً من OAuth                                          ║
 * ║  📁 src/modules/stores/dto/connect-api-store.dto.ts                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorePlatform } from '../entities/store.entity';

export class ConnectApiStoreDto {
  @ApiProperty({
    description: 'المنصة',
    enum: [StorePlatform.SALLA, StorePlatform.ZID],
    example: 'salla',
  })
  @IsIn([StorePlatform.SALLA, StorePlatform.ZID], {
    message: 'المنصة يجب أن تكون salla أو zid',
  })
  platform: StorePlatform;

  @ApiPropertyOptional({
    description: 'اسم المتجر (اختياري - يُجلب تلقائياً من المنصة)',
    example: 'متجر الأناقة',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({
    description: 'مفتاح الـ API (Access Token أو API Key)',
    example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  })
  @IsString({ message: 'مفتاح الـ API مطلوب' })
  @IsNotEmpty({ message: 'مفتاح الـ API لا يمكن أن يكون فارغاً' })
  @MinLength(10, { message: 'مفتاح الـ API قصير جداً' })
  @MaxLength(2000, { message: 'مفتاح الـ API طويل جداً' })
  apiKey: string;

  @ApiPropertyOptional({
    description: 'كلمة سر الـ API (Refresh Token أو API Secret)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  apiSecret?: string;

  @ApiPropertyOptional({
    description: 'رابط المتجر',
    example: 'https://mystore.salla.sa',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}
