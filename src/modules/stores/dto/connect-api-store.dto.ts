/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - API Connect DTO                            ║
 * ║                                                                                ║
 * ║  DTO للربط عبر API Key بدلاً من OAuth                                          ║
 * ║  🆕 يدعم متاجر أخرى (other) بالإضافة لسلة وزد                                ║
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
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StorePlatform } from '../entities/store.entity';

export class ConnectApiStoreDto {
  @ApiProperty({
    description: 'المنصة',
    enum: [StorePlatform.SALLA, StorePlatform.ZID, StorePlatform.OTHER],
    example: 'salla',
  })
  @IsIn([StorePlatform.SALLA, StorePlatform.ZID, StorePlatform.OTHER], {
    message: 'المنصة يجب أن تكون salla أو zid أو other',
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🆕 حقول المتاجر الأخرى (مطلوبة فقط إذا platform = other)
  // ═══════════════════════════════════════════════════════════════════════════════

  @ApiPropertyOptional({
    description: 'اسم المنصة (مطلوب للمتاجر الأخرى)',
    example: 'Shopify',
  })
  @ValidateIf((o) => o.platform === StorePlatform.OTHER)
  @IsNotEmpty({ message: 'اسم المنصة مطلوب للمتاجر الأخرى' })
  @IsString()
  @MaxLength(100)
  platformName?: string;

  @ApiPropertyOptional({
    description: 'رابط API الأساسي للتحقق من صحة المفتاح (مطلوب للمتاجر الأخرى)',
    example: 'https://mystore.myplatform.com/api',
  })
  @ValidateIf((o) => o.platform === StorePlatform.OTHER)
  @IsNotEmpty({ message: 'رابط API مطلوب للتحقق من المفتاح' })
  @IsString()
  @MaxLength(500)
  apiBaseUrl?: string;
}
