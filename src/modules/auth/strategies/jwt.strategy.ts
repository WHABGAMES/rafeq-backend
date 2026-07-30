/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - JWT Strategy                               ║
 * ║                                                                                ║
 * ║  📌 ماهو JWT (JSON Web Token)؟                                                  ║
 * ║                                                                                ║
 * ║  JWT هو طريقة آمنة لنقل المعلومات بين طرفين                                     ║
 * ║                                                                                ║
 * ║  شكل الـ JWT:                                                                   ║
 * ║  xxxxx.yyyyy.zzzzz                                                            ║
 * ║  │     │     └── Signature (التوقيع)                                           ║
 * ║  │     └── Payload (البيانات)                                                  ║
 * ║  └── Header (النوع والخوارزمية)                                                 ║
 * ║                                                                                ║
 * ║  كيف يعمل:                                                                      ║
 * ║  1. المستخدم يسجل دخول → يحصل على JWT                                           ║
 * ║  2. يرسل JWT في كل request: Authorization: Bearer <token>                     ║
 * ║  3. السيرفر يتحقق من التوقيع ويستخرج بيانات المستخدم                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, UnauthorizedException, Inject, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '@database/entities/user.entity';
import Redis from 'ioredis';

/**
 * 📌 JWT Payload Interface
 * 
 * البيانات المخزنة داخل الـ Token
 */
export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  deviceToken?: string;   // توكن الجهاز لإبطال الجلسة فوراً
  jti?: string;           // معرّف التوكن الفريد — يُستخدم للإبطال (blacklist)
  type?: 'access' | 'refresh' | 'impersonation'; // نوع التوكن
  iat?: number;
  exp?: number;

  // ─── حقول خاصة بتوكن انتحال الهوية (impersonation) فقط ───
  impersonatedBy?: string;      // معرّف الأدمن الذي بدأ الجلسة
  impersonatedByEmail?: string; // بريد الأدمن (للتدقيق)
  viewOnly?: boolean;           // true = يُمنع أي تعديل (قراءة فقط)
}

/**
 * 📌 JWT Strategy
 * 
 * Passport strategy للتحقق من JWT tokens
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {
    super({
      // ═══════════════════════════════════════════════════════════════════════════════
      // من أين نستخرج الـ Token
      // ═══════════════════════════════════════════════════════════════════════════════
      
      /**
       * نستخرج الـ Token من الـ Authorization header
       * Format: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
       */
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // هل نتجاهل الـ tokens المنتهية الصلاحية؟
      // ═══════════════════════════════════════════════════════════════════════════════
      
      /**
       * false = نرفض الـ tokens المنتهية
       * true = نقبلها (غير آمن!)
       */
      ignoreExpiration: false,
      
      // ═══════════════════════════════════════════════════════════════════════════════
      // المفتاح السري للتحقق من التوقيع
      // ═══════════════════════════════════════════════════════════════════════════════
      
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * 🔍 validate
   * 
   * يُستدعى بعد التحقق من صحة الـ Token
   * 
   * @param payload - البيانات المستخرجة من الـ Token
   * @returns User - المستخدم (يُضاف للـ request)
   * @throws UnauthorizedException - إذا المستخدم غير موجود أو غير نشط
   * 
   * بعد هذه الدالة، يمكن الوصول للمستخدم عبر:
   * @Request() req → req.user
   * أو باستخدام @CurrentUser() decorator
   */
  async validate(payload: JwtPayload): Promise<User> {
    // ═══════════════════════════════════════════════════════════════════════════
    // 🔒 FIX F-02: التحقق من القائمة السوداء لتوكن الوصول
    // ───────────────────────────────────────────────────────────────────────────
    // logout() يضيف jti التوكن إلى token_blacklist:* لكن هذه الاستراتيجية لم تكن
    // تفحصها إطلاقاً، فكان توكن الوصول يبقى صالحاً بعد تسجيل الخروج حتى انتهاء عمره.
    // نفحص هنا قبل أي شيء آخر — يشمل توكنات الوصول والانتحال التي تحمل jti.
    // ملاحظة: توكنات الانتحال الحالية لا تحمل jti، لذا يتخطاها هذا الفحص بأمان.
    //
    // ⚖️ سياسة التوافر (مهمة لمنصة تخدم آلاف العملاء):
    //   - هذا الفحص يعمل لكل توكن وصول (كلها تحمل jti)، بخلاف فحص الجهاز.
    //   - لو انقطع Redis كلياً فإن .get() ترمي بعد إعادة المحاولات → لو تركناها
    //     تنتشر، لخرج كل العملاء النشطين فوراً (تعطّل واسع).
    //   - لذا: fail-open عند خطأ Redis (نُسجّل ونسمح)، fail-closed عند تأكيد الإبطال.
    //     بقاء توكن مُبطَل صالحاً دقائقَ نادرة أثناء عطل Redis أهون بكثير من
    //     تسجيل خروج كل العملاء أثناء نفس العطل.
    // ═══════════════════════════════════════════════════════════════════════════
    if (payload.jti) {
      let isBlacklisted: string | null = null;
      try {
        isBlacklisted = await this.redis.get(`token_blacklist:${payload.jti}`);
      } catch (err) {
        // fail-open: خطأ في Redis لا يجب أن يُسقط العملاء الصالحين
        this.logger.error(
          `فشل فحص القائمة السوداء (jti=${payload.jti}) — سُمح بالمرور مؤقتاً: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (isBlacklisted) {
        // fail-closed: إجابة قاطعة بأن التوكن مُبطَل → نرفض
        throw new UnauthorizedException('تم إبطال هذا التوكن. يرجى تسجيل الدخول مجدداً.');
      }
    }

    // ✅ Handle impersonation tokens (admin viewing merchant dashboard)
    if (payload.type === 'impersonation' && payload.sub) {
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ['tenant'],
      });
      if (!user) throw new UnauthorizedException('المستخدم غير موجود');
      if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('الحساب غير مفعّل');
      user._impersonation = true;
      user._impersonatedBy = payload.impersonatedBy;
      // 🔒 FIX F-01: راية القراءة فقط — يفرضها ImpersonationReadOnlyInterceptor
      // نستخدم افتراضاً آمناً: أي توكن انتحال يُعامَل كقراءة فقط ما لم يُصرَّح صراحةً بغير ذلك
      user._viewOnly = payload.viewOnly !== false;
      return user;
    }

    // التحقق من وجود البيانات الأساسية
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // ✅ التحقق من أن الجهاز لم يُلغَ ثقته
    if (payload.deviceToken) {
      const revoked = await this.redis.get(`device_revoked:${payload.deviceToken}`);
      if (revoked) throw new UnauthorizedException('تم إلغاء ثقة هذا الجهاز');
    }

    // البحث عن المستخدم
    const user = await this.userRepository.findOne({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
      },
      relations: ['tenant'],
    });

    // التحقق من وجود المستخدم
    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    // التحقق من حالة المستخدم
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    // التحقق من حالة المتجر
    // ⚠️ نسمح لكل الحالات بالدخول (suspended/inactive/pending) لعرض رسالة التجديد
    // نمنع فقط إذا التاجر محذوف أو غير موجود
    if (user.tenant && !['active', 'trial', 'suspended', 'inactive', 'pending'].includes(user.tenant.status)) {
      throw new UnauthorizedException('المتجر موقوف أو ملغي');
    }

    // إرجاع المستخدم (سيُضاف للـ request.user)
    return user;
  }
}

/**
 * 📌 كيفية الاستخدام:
 * 
 * 1. حماية route كامل:
 * 
 *    @Controller('users')
 *    @UseGuards(JwtAuthGuard)  // كل الـ routes محمية
 *    export class UsersController { }
 * 
 * 2. حماية route معين:
 * 
 *    @Get('profile')
 *    @UseGuards(JwtAuthGuard)  // هذا الـ route فقط محمي
 *    getProfile() { }
 * 
 * 3. الوصول للمستخدم الحالي:
 * 
 *    @Get('me')
 *    @UseGuards(JwtAuthGuard)
 *    getMe(@CurrentUser() user: User) {
 *      return user;
 *    }
 */
