/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid Webhook DTOs                               ║
 * ║                                                                                ║
 * ║  تعريف شكل البيانات الواردة من زد                                               ║
 * ║  Zid Webhook Docs: https://docs.zid.sa/docs/webhooks                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 Zid Webhook Base DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * الشكل الأساسي لكل webhook من زد
 *
 * {
 *   "event": "new-order",
 *   "store_id": "12345",
 *   "triggered_at": "2024-01-15T10:30:00.000Z",
 *   "payload": { ... }
 * }
 */
export class ZidWebhookDto {
  @ApiProperty({
    description: 'نوع الحدث',
    example: 'new-order',
  })
  @IsString()
  event: string;

  @ApiProperty({
    description: 'معرّف المتجر في زد',
    example: '12345',
  })
  @IsString()
  store_id: string;

  @ApiPropertyOptional({
    description: 'تاريخ إطلاق الحدث',
    example: '2024-01-15T10:30:00.000Z',
  })
  @IsString()
  @IsOptional()
  triggered_at?: string;

  @ApiProperty({
    description: 'بيانات الحدث',
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  // بعض أحداث زد ترسل البيانات في data بدل payload
  @ApiPropertyOptional({
    description: 'بيانات الحدث (بديل)',
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;
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
