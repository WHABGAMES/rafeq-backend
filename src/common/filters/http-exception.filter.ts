/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - HTTP Exception Filter                            ║
 * ║                                                                                ║
 * ║  📌 فلتر موحد للأخطاء - يضمن إرسال الأخطاء بشكل موحد للـ Frontend             ║
 * ║                                                                                ║
 * ║  شكل الرد الموحد:                                                              ║
 * ║  {                                                                             ║
 * ║    "success": false,                                                           ║
 * ║    "error": {                                                                  ║
 * ║      "code": "VALIDATION_ERROR",                                               ║
 * ║      "message": "البيانات غير صحيحة",                                          ║
 * ║      "details": [...],                                                         ║
 * ║      "timestamp": "2024-01-15T10:30:00Z",                                      ║
 * ║      "path": "/api/v1/auth/login"                                              ║
 * ║    }                                                                           ║
 * ║  }                                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Error Codes للـ Frontend
 */
export enum ErrorCode {
  // Authentication Errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  
  // Validation Errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  
  // Resource Errors
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  
  // Permission Errors
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  // Rate Limiting
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  
  // Server Errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  
  // Business Logic Errors
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  CHANNEL_NOT_CONNECTED = 'CHANNEL_NOT_CONNECTED',
  STORE_NOT_CONNECTED = 'STORE_NOT_CONNECTED',
}

/**
 * شكل الـ Error Response
 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    path: string;
    requestId?: string;
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // تحديد الـ status code
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // تحديد الـ error code
    const errorCode = this.getErrorCode(status, exception);

    // تحديد الرسالة
    const message = this.getMessage(exception);

    // تحديد التفاصيل
    const details = this.getDetails(exception);

    // Request ID للتتبع
    const requestId = request.headers['x-request-id'] as string;

    // بناء الـ response
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code: errorCode,
        message,
        ...(details !== undefined ? { details } : {}),
        timestamp: new Date().toISOString(),
        path: request.url,
        ...(requestId ? { requestId } : {}),
      },
    };

    // تسجيل الخطأ
    this.logger.error(
      `[${errorCode}] ${message}`,
      {
        status,
        path: request.url,
        method: request.method,
        requestId,
        details,
        stack: exception instanceof Error ? exception.stack : undefined,
      },
    );

    // إرسال الرد
    response.status(status).json(errorResponse);
  }

  /**
   * تحديد Error Code بناءً على الـ status
   */
  private getErrorCode(status: number, exception: unknown): string {
    // إذا كان الخطأ يحتوي على code مخصص
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        return (response as { code: string }).code;
      }
    }

    // تحديد بناءً على الـ status
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.ALREADY_EXISTS;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.TOO_MANY_REQUESTS;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }

  /**
   * استخراج الرسالة من الخطأ
   */
  private getMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      
      if (typeof response === 'string') {
        return response;
      }
      
      if (typeof response === 'object' && response !== null) {
        if ('message' in response) {
          const msg = (response as { message: unknown }).message;
          if (Array.isArray(msg)) {
            return msg[0];
          }
          return String(msg);
        }
      }
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'حدث خطأ غير متوقع';
  }

  /**
   * استخراج تفاصيل الخطأ (للـ validation errors)
   */
  private getDetails(exception: unknown): unknown {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      
      if (typeof response === 'object' && response !== null) {
        if ('message' in response) {
          const msg = (response as { message: unknown }).message;
          if (Array.isArray(msg) && msg.length > 1) {
            return msg;
          }
        }
        
        if ('errors' in response) {
          return (response as { errors: unknown }).errors;
        }
      }
    }

    return undefined;
  }
}
