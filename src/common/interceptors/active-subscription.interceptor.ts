/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Active Subscription Interceptor                     ║
 * ║                                                                                ║
 * ║  📌 يمنع عمليات الإنشاء/التعديل/التفعيل إذا الاشتراك منتهي أو غير موجود      ║
 * ║  ✅ يعمل كـ Interceptor (بعد التوثيق) — يضمن توفر request.user.tenant         ║
 * ║  - GET مسموح دائماً (التصفح مفتوح)                                             ║
 * ║  - بعض المسارات معفاة (auth, billing, inbox, admin, webhooks)                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

// المسارات المعفاة — لا تُحجب أبداً
const EXEMPT_PREFIXES = [
  '/api/auth/',
  '/api/billing/',
  '/api/admin/',
  '/api/webhooks/',
  '/api/inbox/',
  '/api/messaging/',
  '/api/contacts/',
  '/api/stores/',
  '/api/channels/',
  '/api/health',
  '/api/employee-notifications/my/',
  '/otp/',
];

@Injectable()
export class ActiveSubscriptionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // GET/HEAD/OPTIONS مسموحة دائماً
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    // المسارات المعفاة
    const path: string = request.url || request.path || '';
    if (EXEMPT_PREFIXES.some(p => path.startsWith(p))) {
      return next.handle();
    }

    // التحقق من المستخدم والتاجر
    const user = request.user;
    if (!user?.tenantId) return next.handle();

    const tenant = user.tenant;
    if (!tenant) return next.handle();

    // التحقق من حالة الاشتراك
    const status = tenant.status;
    const plan = tenant.subscriptionPlan || 'free';
    const isSuspended = status === 'suspended' || status === 'inactive';
    const hasNoSubscription = (plan === 'free' || !plan) && status !== 'trial';

    if (isSuspended || hasNoSubscription) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message: hasNoSubscription
          ? 'لا يوجد اشتراك نشط. يرجى الاشتراك في إحدى الباقات لتتمكن من استخدام هذه الميزة.'
          : 'انتهى اشتراكك. يرجى تجديد الاشتراك لتتمكن من استخدام هذه الميزة.',
        action: 'renew',
        renewUrl: '/dashboard/billing',
      });
    }

    return next.handle();
  }
}
