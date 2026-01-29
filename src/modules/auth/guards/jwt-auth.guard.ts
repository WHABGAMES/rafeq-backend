/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - JWT Auth Guard                             ║
 * ║                                                                                ║
 * ║  📌 ماهو Guard؟                                                                 ║
 * ║                                                                                ║
 * ║  Guard = حارس يقرر هل يُسمح للـ request بالمرور أم لا                           ║
 * ║                                                                                ║
 * ║  ترتيب تنفيذ الـ Request في NestJS:                                             ║
 * ║  Middleware → Guards → Interceptors → Pipes → Controller                      ║
 * ║                  ↑                                                            ║
 * ║              نحن هنا!                                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

/**
 * 📌 مفتاح الـ Metadata للـ Public routes
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 📌 Decorator لجعل route عام (بدون توثيق)
 * 
 * @example
 * @Public()
 * @Get('status')
 * getStatus() {
 *   return { status: 'ok' };
 * }
 */
export const Public = () =>
  (target: object, _key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, descriptor.value as object);
      return descriptor;
    }
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, target);
    return target;
  };

/**
 * 📌 JWT Auth Guard
 * 
 * يستخدم JwtStrategy للتحقق من الـ Token
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  /**
   * 🔐 canActivate
   * 
   * يُستدعى قبل كل request محمي
   * 
   * @returns true = مسموح، false = ممنوع
   */
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // ═══════════════════════════════════════════════════════════════════════════════
    // التحقق من @Public() decorator
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * إذا كان الـ route معلّم بـ @Public()
     * نسمح بالمرور بدون توثيق
     */
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),   // التحقق من الـ method
      context.getClass(),     // التحقق من الـ class
    ]);

    if (isPublic) {
      return true;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // التحقق من الـ JWT Token
    // ═══════════════════════════════════════════════════════════════════════════════
    
    // استدعاء الـ parent للتحقق من الـ Token
    // هذا يستدعي JwtStrategy.validate()
    return super.canActivate(context);
  }

  /**
   * 🚫 handleRequest
   * 
   * يُستدعى بعد canActivate
   * يسمح بتخصيص رسائل الخطأ
   * 
   * @param err - الخطأ (إن وجد)
   * @param user - المستخدم (من JwtStrategy.validate)
   * @param info - معلومات إضافية
   */
  handleRequest<T>(
    err: Error | null,
    user: T | false,
    info: { message?: string } | undefined,
  ): T {
    // إذا كان هناك خطأ أو لا يوجد مستخدم
    if (err || !user) {
      // تخصيص رسالة الخطأ حسب السبب
      let message = 'غير مصرح لك بالوصول';

      if (info?.message === 'jwt expired') {
        message = 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى';
      } else if (info?.message === 'No auth token') {
        message = 'يرجى تسجيل الدخول للوصول لهذا المورد';
      } else if (info?.message === 'jwt malformed') {
        message = 'الـ Token غير صالح';
      }

      throw new UnauthorizedException(message);
    }

    return user;
  }
}

/**
 * 📌 أمثلة الاستخدام:
 * 
 * 1. حماية Controller كامل:
 * 
 *    @Controller('users')
 *    @UseGuards(JwtAuthGuard)
 *    export class UsersController {
 *      // كل الـ routes محمية
 *    }
 * 
 * 2. حماية method معين:
 * 
 *    @Controller('products')
 *    export class ProductsController {
 *      
 *      @Get()
 *      @Public()  // ← متاح للجميع
 *      findAll() { }
 *      
 *      @Post()
 *      @UseGuards(JwtAuthGuard)  // ← يحتاج توثيق
 *      create() { }
 *    }
 * 
 * 3. تطبيق عالمي (في AppModule):
 * 
 *    @Module({
 *      providers: [
 *        {
 *          provide: APP_GUARD,
 *          useClass: JwtAuthGuard,
 *        },
 *      ],
 *    })
 *    export class AppModule {}
 *    
 *    // الآن كل الـ routes محمية افتراضياً
 *    // استخدم @Public() للـ routes العامة
 */
