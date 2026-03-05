/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla Webhook DTOs                             ║
 * ║                                                                                ║
 * ║  تعريف شكل البيانات الواردة من سلة                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { IsString, IsNumber, IsOptional, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 📌 ماهو DTO؟
 * 
 * DTO = Data Transfer Object
 * يُعرّف شكل البيانات المتوقعة ويتحقق منها
 * 
 * فوائد:
 * 1. Type Safety: TypeScript يعرف الأنواع
 * 2. Validation: class-validator يتحقق من البيانات
 * 3. Documentation: Swagger يولّد docs تلقائياً
 * 4. Transform: class-transformer يحوّل البيانات
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 Salla Webhook Base DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * الشكل الأساسي لكل webhook من سلة
 * 
 * {
 *   "event": "order.created",
 *   "merchant": 123456,
 *   "created_at": "2024-01-15T10:30:00.000Z",
 *   "data": { ... }
 * }
 */
export class SallaWebhookDto {
  @ApiProperty({
    description: 'نوع الحدث',
    example: 'order.created',
  })
  @IsString()
  event: string;

  @ApiProperty({
    description: 'معرّف المتجر في سلة',
    example: 123456,
  })
  @IsNumber()
  merchant: number;

  @ApiProperty({
    description: 'تاريخ إنشاء الحدث',
    example: '2024-01-15T10:30:00.000Z',
  })
  @IsString()
  created_at: string;

  @ApiProperty({
    description: 'بيانات الحدث',
    type: 'object',
  })
  @IsObject()
  data: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🛒 Order Events DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات عنصر في الطلب
 */
export class SallaOrderItemDto {
  @ApiProperty({ example: 123 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'SKU123' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ example: 'اسم المنتج' })
  @IsString()
  name: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 100.00 })
  @IsNumber()
  price: number;

  @ApiPropertyOptional()
  @IsOptional()
  thumbnail?: string;
}

/**
 * بيانات العميل
 */
export class SallaCustomerDto {
  @ApiProperty({ example: 789 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'أحمد' })
  @IsString()
  first_name: string;

  @ApiProperty({ example: 'محمد' })
  @IsString()
  last_name: string;

  @ApiPropertyOptional({ example: 'ahmed@example.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: '+966501234567' })
  @IsString()
  mobile: string;
}

/**
 * بيانات عنوان الشحن
 */
export class SallaShippingAddressDto {
  @ApiProperty({ example: 'الرياض' })
  @IsString()
  city: string;

  @ApiPropertyOptional({ example: 'حي النخيل' })
  @IsString()
  @IsOptional()
  district?: string;

  @ApiPropertyOptional({ example: 'شارع الملك فهد' })
  @IsString()
  @IsOptional()
  street?: string;

  @ApiProperty({ example: 'SA' })
  @IsString()
  country: string;

  @ApiPropertyOptional({ example: '12345' })
  @IsString()
  @IsOptional()
  postal_code?: string;
}

/**
 * بيانات الطلب الكاملة
 */
export class SallaOrderDataDto {
  @ApiProperty({ example: 1001 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'ORD-123456' })
  @IsString()
  reference_id: string;

  @ApiProperty({ example: 'created' })
  @IsString()
  status: string;

  @ApiProperty({ example: 500.00 })
  @IsNumber()
  total: number;

  @ApiProperty({ example: 'SAR' })
  @IsString()
  currency: string;

  @ApiProperty({ type: SallaCustomerDto })
  @ValidateNested()
  @Type(() => SallaCustomerDto)
  customer: SallaCustomerDto;

  @ApiProperty({ type: [SallaOrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => SallaOrderItemDto)
  items: SallaOrderItemDto[];

  @ApiPropertyOptional({ type: SallaShippingAddressDto })
  @ValidateNested()
  @Type(() => SallaShippingAddressDto)
  @IsOptional()
  shipping_address?: SallaShippingAddressDto;

  @ApiPropertyOptional({ example: 'paid' })
  @IsString()
  @IsOptional()
  payment_status?: string;

  @ApiPropertyOptional({ example: 'mada' })
  @IsString()
  @IsOptional()
  payment_method?: string;

  @ApiPropertyOptional({ example: 'ملاحظات العميل' })
  @IsString()
  @IsOptional()
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 👤 Customer Events DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات العميل الكاملة
 */
export class SallaCustomerDataDto {
  @ApiProperty({ example: 789 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'أحمد' })
  @IsString()
  first_name: string;

  @ApiProperty({ example: 'محمد' })
  @IsString()
  last_name: string;

  @ApiPropertyOptional({ example: 'ahmed@example.com' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: '+966501234567' })
  @IsString()
  mobile: string;

  @ApiPropertyOptional({ example: 'الرياض' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'SA' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 'ar' })
  @IsString()
  @IsOptional()
  locale?: string;

  @ApiPropertyOptional({ example: 'male' })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00.000Z' })
  @IsString()
  @IsOptional()
  created_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 Product Events DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات المنتج
 */
export class SallaProductDataDto {
  @ApiProperty({ example: 456 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'SKU123' })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ example: 'اسم المنتج' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'وصف المنتج' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 100.00 })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ example: 80.00 })
  @IsNumber()
  @IsOptional()
  sale_price?: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ example: 'active' })
  @IsString()
  @IsOptional()
  status?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🛒 Abandoned Cart DTO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات السلة المتروكة
 */
export class SallaAbandonedCartDataDto {
  @ApiProperty({ example: 321 })
  @IsNumber()
  id: number;

  @ApiProperty({ type: SallaCustomerDto })
  @ValidateNested()
  @Type(() => SallaCustomerDto)
  customer: SallaCustomerDto;

  @ApiProperty({ type: [SallaOrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => SallaOrderItemDto)
  items: SallaOrderItemDto[];

  @ApiProperty({ example: 300.00 })
  @IsNumber()
  total: number;

  @ApiProperty({ example: 'SAR' })
  @IsString()
  currency: string;

  @ApiPropertyOptional({ example: 'https://store.com/checkout/abc' })
  @IsString()
  @IsOptional()
  checkout_url?: string;

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00.000Z' })
  @IsString()
  @IsOptional()
  created_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🚚 Shipment Events DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات الشحنة
 */
export class SallaShipmentDataDto {
  @ApiProperty({ example: 555 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'TRACK123456' })
  @IsString()
  @IsOptional()
  tracking_number?: string;

  @ApiPropertyOptional({ example: 'aramex' })
  @IsString()
  @IsOptional()
  shipping_company?: string;

  @ApiProperty({ example: 'shipped' })
  @IsString()
  status: string;

  @ApiProperty({ example: 1001 })
  @IsNumber()
  order_id: number;

  @ApiPropertyOptional({ example: 'https://track.aramex.com/...' })
  @IsString()
  @IsOptional()
  tracking_url?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔐 App Events DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات تثبيت/إلغاء التطبيق
 */
export class SallaAppDataDto {
  @ApiProperty({ example: 123456 })
  @IsNumber()
  merchant: number;

  @ApiPropertyOptional({ example: 'access_token_xxx' })
  @IsString()
  @IsOptional()
  access_token?: string;

  @ApiPropertyOptional({ example: 'refresh_token_xxx' })
  @IsString()
  @IsOptional()
  refresh_token?: string;

  @ApiPropertyOptional({ example: 3600 })
  @IsNumber()
  @IsOptional()
  expires_in?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 Internal Queue DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * بيانات الـ Job في الـ Queue
 * ✅ FIX #2: أضفنا signatureVerified — يُمرَّر من Controller بقيمة حقيقية
 */
export class SallaWebhookJobDto {
  eventType: string;
  merchant: number;
  data: Record<string, unknown>;
  createdAt: string;
  deliveryId?: string;
  idempotencyKey: string;
  signature?: string;
  /** ✅ القيمة الحقيقية من التحقق — لا تُثبَّت true أبداً */
  signatureVerified?: boolean;
  ipAddress?: string;
  headers?: Record<string, string>;
}

/**
 * 📌 أمثلة على Webhooks من سلة:
 * 
 * 1. order.created:
 * {
 *   "event": "order.created",
 *   "merchant": 123456,
 *   "created_at": "2024-01-15T10:30:00.000Z",
 *   "data": {
 *     "id": 1001,
 *     "reference_id": "ORD-123456",
 *     "status": "created",
 *     "total": 500.00,
 *     "customer": { "id": 789, "first_name": "أحمد", ... },
 *     "items": [{ "id": 123, "name": "...", "quantity": 2, ... }]
 *   }
 * }
 * 
 * 2. customer.created:
 * {
 *   "event": "customer.created",
 *   "merchant": 123456,
 *   "created_at": "2024-01-15T10:30:00.000Z",
 *   "data": {
 *     "id": 789,
 *     "first_name": "أحمد",
 *     "mobile": "+966501234567",
 *     ...
 *   }
 * }
 * 
 * 3. abandoned.cart:
 * {
 *   "event": "abandoned.cart",
 *   "merchant": 123456,
 *   "created_at": "2024-01-15T10:30:00.000Z",
 *   "data": {
 *     "id": 321,
 *     "customer": { ... },
 *     "items": [...],
 *     "checkout_url": "https://..."
 *   }
 * }
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 📡 Communication Webhooks DTOs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * أنواع الأحداث التجارية في Communication Webhooks
 * يُرسَل في data.type للتعبير عن سبب الرسالة
 */
export enum CommunicationEventType {
  AUTH_OTP_VERIFICATION    = 'auth.otp.verification',
  ORDER_STATUS_CONFIRMATION = 'order.status.confirmation',
  ORDER_STATUS_UPDATED     = 'order.status.updated',
  ORDER_INVOICE_ISSUED     = 'order.invoice.issued',
  ORDER_SHIPMENT_CREATED   = 'order.shipment.created',
  ORDER_REFUND_PROCESSED   = 'order.refund.processed',
  ORDER_GIFT_PLACED        = 'order.gift.placed',
  PAYMENT_REMINDER_DUE     = 'payment.reminder.due',
  PRODUCT_AVAILABILITY_ALERT = 'product.availability.alert',
  PRODUCT_DIGITAL_CODE     = 'product.digital.code',
  CUSTOMER_CART_ABANDONED  = 'customer.cart.abandoned',
  CUSTOMER_LOYALTY_EARNED  = 'customer.loyalty.earned',
  CUSTOMER_FEEDBACK_REPLY  = 'customer.feedback.reply',
  CUSTOMER_RATING_REQUEST  = 'customer.rating.request',
  MARKETING_CAMPAIGN_BROADCAST = 'marketing.campaign.broadcast',
  SYSTEM_ALERT_GENERAL     = 'system.alert.general',
  SYSTEM_MESSAGE_CUSTOM    = 'system.message.custom',
}

/**
 * الكيان المرتبط بالحدث (قد يكون null)
 * entity.type: 'order' | 'cart' | 'shipment' | 'product' | 'feedback'
 */
export class CommunicationEntityDto {
  @ApiPropertyOptional({ example: 1741773897 })
  @IsNumber()
  @IsOptional()
  id?: number;

  @ApiPropertyOptional({ example: 'order', enum: ['order', 'cart', 'shipment', 'product', 'feedback'] })
  @IsString()
  @IsOptional()
  type?: string;
}

/**
 * بيانات meta في Communication Webhooks
 * customer_id: معرّف العميل في سلة (موجود في معظم الأحداث)
 * code: كود OTP (فقط في auth.otp.verification)
 */
export class CommunicationMetaDto {
  @ApiPropertyOptional({ description: 'معرف العميل في سلة', example: 239462497 })
  @IsNumber()
  @IsOptional()
  customer_id?: number;

  @ApiPropertyOptional({ description: 'كود OTP (فقط في auth.otp.verification)', example: '1234' })
  @IsString()
  @IsOptional()
  code?: string;
}

/**
 * 📡 بيانات الـ Communication Webhook
 *
 * هذا الـ DTO يمثّل بيانات الحدث الكاملة من سلة.
 * الفرق الجوهري عن الأحداث التقليدية:
 *   - notifiable: أرقام/إيميلات المستلمين جاهزة ✅
 *   - content:    نص الرسالة مُصيَّغ مسبقاً ✅
 *   - type:       نوع الحدث التجاري (لأغراض التصنيف)
 *   - entity:     الكيان المرتبط (قد يكون null)
 *   - meta:       بيانات إضافية (customer_id, code)
 *
 * مثال:
 * {
 *   "event": "communication.whatsapp.send",
 *   "merchant": 292111819,
 *   "data": {
 *     "notifiable": ["+96656000000"],
 *     "type": "order.status.updated",
 *     "content": "أصبحت حالة طلبك #218103278 [تم التنفيذ]",
 *     "entity": { "id": 1741773897, "type": "order" },
 *     "meta": { "customer_id": 239462497 }
 *   }
 * }
 */
export class SallaCommunicationDataDto {
  @ApiProperty({
    description: 'قائمة أرقام الهاتف (SMS/WhatsApp) أو الإيميلات (Email) للمستلمين',
    type: [String],
    example: ['+96656000000'],
  })
  @IsOptional()
  notifiable?: string[];

  @ApiProperty({
    description: 'نوع الحدث التجاري',
    enum: CommunicationEventType,
    example: 'order.status.updated',
  })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({
    description: 'نص الرسالة المُصيَّغ جاهزاً من سلة',
    example: 'أصبحت حالة طلبك #218103278 [تم التنفيذ]',
  })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({
    description: 'الكيان المرتبط بالحدث (قد يكون null)',
    type: CommunicationEntityDto,
    nullable: true,
  })
  @IsOptional()
  entity?: CommunicationEntityDto | null;

  @ApiPropertyOptional({
    description: 'بيانات إضافية (customer_id, code)',
    type: CommunicationMetaDto,
    nullable: true,
  })
  @IsOptional()
  meta?: CommunicationMetaDto | null;
}
