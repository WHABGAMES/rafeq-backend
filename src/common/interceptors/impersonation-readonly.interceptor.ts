/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║       RAFIQ PLATFORM - Impersonation Read-Only Interceptor                     ║
 * ║                                                                                ║
 * ║  🔒 FIX F-01: فرض وضع «القراءة فقط» على جلسات انتحال الهوية                   ║
 * ║                                                                                ║
 * ║  المشكلة الجذرية:                                                              ║
 * ║   توكن الانتحال يحمل viewOnly:true، وJwtStrategy تضبط user._viewOnly،         ║
 * ║   لكن لا شيء في المنظومة كان يقرأ هذه الراية — فكانت جلسة «العرض فقط»          ║
 * ║   تملك فعلياً صلاحية كتابة كاملة على حساب التاجر.                              ║
 * ║                                                                                ║
 * ║  الحل:                                                                         ║
 * ║   Interceptor عام (APP_INTERCEPTOR) يعمل بعد التوثيق — فيضمن توفّر request.user║
 * ║   ويمنع أي طريقة HTTP تُغيّر الحالة (غير GET/HEAD/OPTIONS) عندما _viewOnly=true.║
 * ║                                                                                ║
 * ║  لماذا Interceptor عام وليس Guard على كل Controller؟                          ║
 * ║   - التغطية الشاملة تلقائياً دون لمس عشرات الملفات (وهو سبب ثغرة F-01 أصلاً). ║
 * ║   - نفس نمط ActiveSubscriptionInterceptor الموجود في المشروع.                 ║
 * ║   - الـ Interceptor يعمل بعد الـ Guards فيكون request.user جاهزاً.            ║
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

@Injectable()
export class ImpersonationReadOnlyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request?.user;

    // لا يوجد مستخدم أو الجلسة ليست جلسة انتحال → لا شيء نفرضه
    if (!user?._impersonation || !user?._viewOnly) {
      return next.handle();
    }

    // القراءة مسموحة دائماً في جلسة الانتحال
    const method: string = (request.method || '').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    // أي عملية تُغيّر الحالة (POST/PUT/PATCH/DELETE) ممنوعة
    throw new ForbiddenException({
      code: 'IMPERSONATION_VIEW_ONLY',
      message: 'جلسة انتحال الهوية للقراءة فقط — لا يُسمح بأي تعديل.',
    });
  }
}
