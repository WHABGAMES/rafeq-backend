/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - API Response DTOs                                ║
 * ║                                                                                ║
 * ║  📌 أنماط الردود الموحدة للـ API                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ═══════════════════════════════════════════════════════════════════════════════
// Success Response
// ═══════════════════════════════════════════════════════════════════════════════

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 10 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNext: boolean;

  @ApiProperty({ example: false })
  hasPrev: boolean;
}

export class ResponseMetaDto {
  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  timestamp: string;

  @ApiPropertyOptional({ example: 'uuid-request-id' })
  requestId?: string;

  @ApiPropertyOptional({ type: PaginationMetaDto })
  pagination?: PaginationMetaDto;
}

export class ApiSuccessResponseDto<T> {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty()
  data: T;

  @ApiProperty({ type: ResponseMetaDto })
  meta: ResponseMetaDto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Error Response
// ═══════════════════════════════════════════════════════════════════════════════

export class ErrorDetailsDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: 'البيانات غير صحيحة' })
  message: string;

  @ApiPropertyOptional({ example: ['البريد الإلكتروني مطلوب', 'كلمة المرور قصيرة جداً'] })
  details?: string[];

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/auth/login' })
  path: string;

  @ApiPropertyOptional({ example: 'uuid-request-id' })
  requestId?: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success: false;

  @ApiProperty({ type: ErrorDetailsDto })
  error: ErrorDetailsDto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Common DTOs
// ═══════════════════════════════════════════════════════════════════════════════

export class MessageResponseDto {
  @ApiProperty({ example: 'تمت العملية بنجاح' })
  message: string;
}

export class IdResponseDto {
  @ApiProperty({ example: 'uuid-id' })
  id: string;
}

export class DeleteResponseDto {
  @ApiProperty({ example: true })
  deleted: boolean;

  @ApiProperty({ example: 'uuid-id' })
  id: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pagination Query DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 100, default: 10 })
  limit?: number = 10;

  @ApiPropertyOptional({ example: 'createdAt' })
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ example: 'DESC', enum: ['ASC', 'DESC'] })
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @ApiPropertyOptional({ example: 'search term' })
  search?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Date Range Query DTO
// ═══════════════════════════════════════════════════════════════════════════════

export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2024-01-01' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-01-31' })
  endDate?: string;
}
