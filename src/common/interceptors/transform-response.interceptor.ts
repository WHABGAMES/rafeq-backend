/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Transform Response Interceptor                   ║
 * ║                                                                                ║
 * ║  📌 يحول جميع الردود لشكل موحد للـ Frontend                                   ║
 * ║                                                                                ║
 * ║  شكل الرد الموحد:                                                              ║
 * ║  {                                                                             ║
 * ║    "success": true,                                                            ║
 * ║    "data": { ... },                                                            ║
 * ║    "meta": {                                                                   ║
 * ║      "timestamp": "2024-01-15T10:30:00Z",                                      ║
 * ║      "requestId": "uuid",                                                      ║
 * ║      "pagination": { ... }  // إذا كان هناك pagination                        ║
 * ║    }                                                                           ║
 * ║  }                                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';

/**
 * شكل الـ Success Response
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta: {
    timestamp: string;
    requestId?: string;
    pagination?: PaginationMeta;
  };
}

/**
 * معلومات الـ Pagination
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * شكل الـ Paginated Response من الـ Service
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class TransformResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string;

    return next.handle().pipe(
      map((data) => {
        // إذا كان الرد null أو undefined
        if (data === null || data === undefined) {
          return {
            success: true as const,
            data: null as T,
            meta: {
              timestamp: new Date().toISOString(),
              ...(requestId && { requestId }),
            },
          };
        }

        // إذا كان الرد يحتوي على pagination
        if (this.isPaginatedResult(data)) {
          return {
            success: true as const,
            data: data.items as T,
            meta: {
              timestamp: new Date().toISOString(),
              ...(requestId && { requestId }),
              pagination: {
                page: data.page,
                limit: data.limit,
                total: data.total,
                totalPages: Math.ceil(data.total / data.limit),
                hasNext: data.page * data.limit < data.total,
                hasPrev: data.page > 1,
              },
            },
          };
        }

        // رد عادي
        return {
          success: true as const,
          data,
          meta: {
            timestamp: new Date().toISOString(),
            ...(requestId && { requestId }),
          },
        };
      }),
    );
  }

  /**
   * التحقق إذا كان الرد يحتوي على pagination
   */
  private isPaginatedResult(data: unknown): data is PaginatedResult<unknown> {
    return (
      typeof data === 'object' &&
      data !== null &&
      'items' in data &&
      'total' in data &&
      'page' in data &&
      'limit' in data &&
      Array.isArray((data as PaginatedResult<unknown>).items)
    );
  }
}
