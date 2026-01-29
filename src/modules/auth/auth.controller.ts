/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Controller                            ║
 * ║                                                                                ║
 * ║  📌 ماهو Controller؟                                                            ║
 * ║                                                                                ║
 * ║  Controller = يستقبل الـ HTTP requests ويُرجع responses                         ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  POST /auth/login      → تسجيل الدخول                                          ║
 * ║  POST /auth/register   → إنشاء حساب جديد                                       ║
 * ║  POST /auth/refresh    → تجديد الـ Token                                       ║
 * ║  POST /auth/logout     → تسجيل الخروج                                          ║
 * ║  GET  /auth/me         → بيانات المستخدم الحالي                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  TokensDto,
  ChangePasswordDto,
} from './dto';
import { JwtAuthGuard, Public } from './guards/jwt-auth.guard';
import { User } from '@database/entities';

/**
 * 📌 Request Interface مع المستخدم
 */
interface RequestWithUser extends Request {
  user: User;
}

@Controller({
  path: 'auth',
  version: '1',  // /api/v1/auth
})
@ApiTags('Auth')  // تجميع في Swagger
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 LOGIN - تسجيل الدخول
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/auth/login
   * 
   * تسجيل الدخول بالبريد وكلمة المرور
   * 
   * @body { email: string, password: string }
   * @returns { accessToken, refreshToken, expiresIn }
   */
  @Post('login')
  @Public()  // متاح للجميع (بدون توثيق)
  @HttpCode(HttpStatus.OK)  // 200 بدلاً من 201
  @ApiOperation({
    summary: 'تسجيل الدخول',
    description: 'تسجيل الدخول باستخدام البريد الإلكتروني وكلمة المرور',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'تم تسجيل الدخول بنجاح',
    type: TokensDto,
  })
  @ApiResponse({
    status: 401,
    description: 'بيانات الدخول غير صحيحة',
  })
  async login(@Body() dto: LoginDto): Promise<TokensDto> {
    return this.authService.login(dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 REGISTER - إنشاء حساب جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/auth/register
   * 
   * إنشاء حساب جديد (Tenant + User)
   * 
   * @body { email, password, firstName, lastName, storeName }
   * @returns { accessToken, refreshToken, expiresIn }
   */
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)  // 201
  @ApiOperation({
    summary: 'إنشاء حساب جديد',
    description: 'إنشاء حساب متجر جديد مع المستخدم الأول (صاحب المتجر)',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'تم إنشاء الحساب بنجاح',
    type: TokensDto,
  })
  @ApiResponse({
    status: 400,
    description: 'البيانات غير صحيحة',
  })
  @ApiResponse({
    status: 409,
    description: 'البريد الإلكتروني مستخدم مسبقاً',
  })
  async register(@Body() dto: RegisterDto): Promise<TokensDto> {
    return this.authService.register(dto);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH - تجديد الـ Token
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/auth/refresh
   * 
   * تجديد الـ Access Token باستخدام الـ Refresh Token
   * 
   * @body { refreshToken: string }
   * @returns { accessToken, refreshToken, expiresIn }
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تجديد الـ Token',
    description: 'الحصول على Access Token جديد باستخدام Refresh Token',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'تم تجديد الـ Token بنجاح',
    type: TokensDto,
  })
  @ApiResponse({
    status: 401,
    description: 'الـ Refresh Token غير صالح أو منتهي',
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokensDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT - تسجيل الخروج
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/auth/logout
   * 
   * تسجيل الخروج (إبطال الـ Refresh Token)
   * 
   * @header Authorization: Bearer <token>
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)  // يحتاج توثيق
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')  // للتوثيق في Swagger
  @ApiOperation({
    summary: 'تسجيل الخروج',
    description: 'إبطال الـ Refresh Token وتسجيل الخروج',
  })
  @ApiResponse({
    status: 200,
    description: 'تم تسجيل الخروج بنجاح',
  })
  @ApiResponse({
    status: 401,
    description: 'غير مصرح',
  })
  async logout(@Request() req: RequestWithUser): Promise<{ message: string }> {
    await this.authService.logout(req.user.id);
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 ME - بيانات المستخدم الحالي
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/auth/me
   * 
   * جلب بيانات المستخدم الحالي
   * 
   * @header Authorization: Bearer <token>
   * @returns User
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'بيانات المستخدم الحالي',
    description: 'جلب بيانات المستخدم المسجل دخوله حالياً',
  })
  @ApiResponse({
    status: 200,
    description: 'بيانات المستخدم',
  })
  @ApiResponse({
    status: 401,
    description: 'غير مصرح',
  })
  getMe(@Request() req: RequestWithUser): User {
    // المستخدم موجود في req.user بعد JwtStrategy.validate()
    return req.user;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔒 CHANGE PASSWORD - تغيير كلمة المرور
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/auth/change-password
   * 
   * تغيير كلمة المرور
   * 
   * @header Authorization: Bearer <token>
   * @body { currentPassword, newPassword }
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تغيير كلمة المرور',
    description: 'تغيير كلمة المرور للمستخدم الحالي',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: 'تم تغيير كلمة المرور بنجاح',
  })
  @ApiResponse({
    status: 400,
    description: 'كلمة المرور الحالية غير صحيحة',
  })
  async changePassword(
    @Request() req: RequestWithUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }
}

/**
 * 📌 ملخص الـ Endpoints:
 * 
 * ┌────────────────────────────────────────────────────────────────────┐
 * │ Method │ Path                    │ Auth   │ Description            │
 * ├────────┼─────────────────────────┼────────┼────────────────────────┤
 * │ POST   │ /api/v1/auth/login      │ ❌     │ تسجيل الدخول           │
 * │ POST   │ /api/v1/auth/register   │ ❌     │ إنشاء حساب             │
 * │ POST   │ /api/v1/auth/refresh    │ ❌     │ تجديد الـ Token        │
 * │ POST   │ /api/v1/auth/logout     │ ✅     │ تسجيل الخروج           │
 * │ GET    │ /api/v1/auth/me         │ ✅     │ بيانات المستخدم        │
 * │ POST   │ /api/v1/auth/change-password │ ✅ │ تغيير كلمة المرور     │
 * └────────────────────────────────────────────────────────────────────┘
 */
