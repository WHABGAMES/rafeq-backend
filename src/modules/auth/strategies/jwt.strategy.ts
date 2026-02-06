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

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '@database/entities/user.entity';

/**
 * 📌 JWT Payload Interface
 * 
 * البيانات المخزنة داخل الـ Token
 */
export interface JwtPayload {
  sub: string;        // User ID (subject)
  email: string;      // البريد
  tenantId: string;   // معرّف المتجر
  role: string;       // الدور (owner, manager, agent)
  iat?: number;       // Issued At (وقت الإصدار)
  exp?: number;       // Expiration (وقت الانتهاء)
}

/**
 * 📌 JWT Strategy
 * 
 * Passport strategy للتحقق من JWT tokens
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
    // التحقق من وجود البيانات الأساسية
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // البحث عن المستخدم
    const user = await this.userRepository.findOne({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
      },
      relations: ['tenant'], // جلب بيانات المتجر أيضاً
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
    if (user.tenant && user.tenant.status !== 'active' && user.tenant.status !== 'trial') {
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
