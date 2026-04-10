/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Active Subscription Guard                           ║
 * ║                                                                                ║
 * ║  📌 يمنع عمليات الإنشاء/التعديل/التفعيل إذا الاشتراك منتهي                    ║
 * ║  - يعمل فقط على POST/PUT/PATCH/DELETE                                         ║
 * ║  - GET مسموح دائماً (التصفح مسموح)                                             ║
 * ║  - بعض المسارات معفاة (auth, billing, inbox, admin, webhooks)                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './jwt-auth.guard';

// المسارات المعفاة — لا تُحجب أبداً
const EXEMPT_PREFIXES = [
  '/api/auth/',           // تسجيل الدخول والتوثيق
  '/api/billing/',        // صفحة الاشتراكات (لازم يقدر يجدد)
  '/api/admin/',          // لوحة الأدمن
  '/api/webhooks/',       // الويب هوكات من سلة/زد
  '/api/inbox/',          // المحادثات (مسموحة)
  '/api/messaging/',      // إرسال رسائل المحادثات
  '/api/contacts/',       // العملاء (تصفح + sync)
  '/api/stores/',         // المتاجر (ربط + sync)
  '/api/channels/',       // القنوات (مسموحة)
  '/api/health',          // فحص صحة السيرفر
  '/api/employee-notifications/my/', // قراءة الإشعارات
  '/otp/',                // OTP public pages
];

function isExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix));
}

@Injectable()
export class ActiveSubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // تجاهل المسارات العامة
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const method = request.method;

    // GET و HEAD و OPTIONS مسموحة دائماً — التصفح مفتوح
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

    // المسارات المعفاة
    const path = request.url || request.path || '';
    if (isExemptPath(path)) return true;

    // التحقق من حالة التاجر
    const user = request.user;
    if (!user?.tenantId) return true; // لا يوجد tenant (ربما admin)

    const tenant = user.tenant;
    if (!tenant) return true; // لم يتم تحميل الـ tenant

    // إذا التاجر suspended أو inactive → اشتراك منتهي
    if (tenant.status === 'suspended' || tenant.status === 'inactive') {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'انتهى اشتراكك. يرجى تجديد الاشتراك لتتمكن من استخدام هذه الميزة.',
        action: 'renew',
        renewUrl: '/dashboard/billing',
      });
    }

    return true;
  }
}
