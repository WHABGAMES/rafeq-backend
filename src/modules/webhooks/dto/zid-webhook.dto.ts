/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhook DTOs                               ║
 * ║                                                                                ║
 * ║  ✅ v2: مرن — يقبل أي شكل payload من زد                                       ║
 * ║  زد يرسل store_id كرقم أحياناً وكنص أحياناً                                    ║
 * ║  زد يرسل حقول إضافية كثيرة (conditions, subscriber, original_id, etc.)        ║
 * ║  Zid Webhook Docs: https://docs.zid.sa/docs/webhooks                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsString, IsOptional, IsObject, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 Zid Webhook Base DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * الشكل الأساسي لكل webhook من زد
 *
 * زد يرسل الحدث بأشكال مختلفة:
 * {
 *   "event": "order.status.update",
 *   "store_id": "f47ac10b-..." أو 3078847 (رقم),
 *   "triggered_at": "2024-01-15T10:30:00.000Z",
 *   "payload": { ... },
 *   "conditions": { ... },
 *   "original_id": "...",
 *   "subscriber": "...",
 *   ...حقول إضافية
 * }
 */
export class ZidWebhookDto {
  @ApiProperty({
    description: 'نوع الحدث',
    example: 'order.status.update',
  })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiProperty({
    description: 'معرّف المتجر في زد (قد يكون نص أو رقم)',
    example: '3078847',
  })
  @Transform(({ value }) => String(value))  // ✅ يحوّل الرقم لنص تلقائياً
  @IsString()
  store_id: string;

  @ApiPropertyOptional({
    description: 'تاريخ إطلاق الحدث',
    example: '2024-01-15T10:30:00.000Z',
  })
  @IsOptional()
  triggered_at?: string;

  @ApiPropertyOptional({
    description: 'بيانات الحدث',
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'بيانات الحدث (بديل)',
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  // ═══════════════════════════════════════════════════════════════════════════
  // ✅ v2: حقول إضافية يرسلها زد — بدونها يرجع 400 مع forbidNonWhitelisted
  // ═══════════════════════════════════════════════════════════════════════════

  @IsOptional()
  id?: string;

  @IsOptional()
  conditions?: Record<string, unknown>;

  @IsOptional()
  original_id?: string;

  @IsOptional()
  subscriber?: string;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  target_url?: string;

  @IsOptional()
  status?: unknown;

  @IsOptional()
  message?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 Internal Queue DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات الـ Job في الـ Queue لزد
 */
export class ZidWebhookJobDto {
  eventType: string;
  storeId: string;
  data: Record<string, unknown>;
  triggeredAt: string;
  deliveryId?: string;
  idempotencyKey: string;
  signature?: string;
  ipAddress?: string;
  headers?: Record<string, string>;
}
