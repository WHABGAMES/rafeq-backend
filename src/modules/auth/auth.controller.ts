/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Controller                             ║
 * ║                                                                                ║
 * ║  ✅ v7: Multi-Auth Support + Forgot Password                                 ║
 * ║  POST /auth/check-email     → التحقق من وجود الإيميل                          ║
 * ║  POST /auth/login           → Email + Password                                ║
 * ║  POST /auth/register        → تسجيل حساب جديد                                ║
 * ║  POST /auth/otp/send        → إرسال OTP عبر الإيميل                           ║
 * ║  POST /auth/otp/verify      → التحقق من OTP                                   ║
 * ║  GET  /auth/google/url      → Google OAuth authorization URL                  ║
 * ║  POST /auth/google/callback → Google OAuth callback                           ║
 * ║  GET  /auth/salla/url       → Salla OAuth URL                                ║
 * ║  POST /auth/salla/callback  → Salla OAuth Callback                            ║
 * ║  GET  /auth/zid/url         → Zid OAuth URL                                  ║
 * ║  POST /auth/zid/callback    → Zid OAuth Callback                              ║
 * ║  POST /auth/set-password    → تعيين كلمة مرور (OAuth/OTP users)               ║
 * ║  POST /auth/refresh         → تجديد التوكن                                    ║
 * ║  POST /auth/logout          → تسجيل الخروج                                   ║
 * ║  GET  /auth/me              → بيانات المستخدم الحالي                           ║
 * ║  POST /auth/change-password → تغيير كلمة المرور                               ║
 * ║  POST /auth/forgot-password → 🆕 طلب استعادة كلمة المرور                      ║
 * ║  POST /auth/verify-reset-token → 🆕 التحقق من صلاحية الرابط                   ║
 * ║  POST /auth/reset-password  → 🆕 تحديث كلمة المرور عبر الرابط                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request as ExpressRequest, Response } from 'express';
import { ConfigService } from '@nestjs/config';

import { AuthService, LoginResult } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuditService } from '../admin/services/audit.service';
import { AuditAction } from '../admin/entities/audit-log.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OAuthStateService } from './oauth-state.service';

import {
  LoginDto,
  LoginResponseDto,
  RegisterDto,
  CheckEmailDto,
  CheckEmailResponseDto,
  SendEmailOtpDto,
  VerifyEmailOtpDto,
  OAuthCallbackDto,
  SetPasswordDto,
  RefreshTokenDto,
  RefreshTokenResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  VerifyResetTokenDto,
  ResetPasswordDto,
  MessageResponseDto,
  UserProfileDto,
} from './dto';

type AuthenticatedRequest = ExpressRequest & {
  cookies?: Record<string, string>;
  user?: { sub?: string; id?: string; email?: string; tenantId?: string };
};
type OAuthCallbackRequest = AuthenticatedRequest;

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Unknown error';

@ApiTags('🔐 Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly oauthStateService: OAuthStateService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔒 FIX F-07: توكن التجديد في كوكي httpOnly (بدل تخزينه في localStorage)
  // ───────────────────────────────────────────────────────────────────────────────
  //  الهدف: منع سرقة توكن التجديد عبر XSS (JS لا يستطيع قراءة كوكي httpOnly).
  //  التوافق: نُبقي refreshToken في جسم الاستجابة أيضاً خلال فترة الانتقال، فلا
  //  تنكسر الجلسات النشطة؛ الواجهة الجديدة تعتمد على الكوكي وتتوقف عن تخزينه.
  // ═══════════════════════════════════════════════════════════════════════════════
  private static readonly REFRESH_COOKIE = 'rafeq_rt';
  private static readonly OAUTH_STATE_COOKIE = 'rafeq_oauth_state';

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.cookie(AuthController.REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: isProduction,          // Secure في الإنتاج فقط (يسمح http محلياً)
      sameSite: 'strict',
      path: '/api/auth',             // يُرسَل فقط لمسارات المصادقة
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 أيام (يطابق عمر توكن التجديد)
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(AuthController.REFRESH_COOKIE, { path: '/api/auth' });
  }

  private setOAuthStateCookie(res: Response, state: string): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.cookie(AuthController.OAUTH_STATE_COOKIE, state, {
      httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/api/auth', maxAge: 10 * 60 * 1000,
    });
  }

  private clearOAuthStateCookie(res: Response): void {
    res.clearCookie(AuthController.OAUTH_STATE_COOKIE, { path: '/api/auth' });
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***@***';
    const masked = local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
    return `${masked}@${domain}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧 CHECK EMAIL - هل الإيميل مسجل؟
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من وجود الإيميل' })
  @ApiResponse({ status: 200, type: CheckEmailResponseDto })
  async checkEmail(@Body() dto: CheckEmailDto): Promise<CheckEmailResponseDto> {
    return this.authService.checkEmail(dto.email);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 LOGIN - Email + Password
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الدخول بالإيميل وكلمة المرور' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() dto: LoginDto, @Request() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    this.logger.log(`Login attempt: ${this.maskEmail(dto.email)}`);
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const ua = req.headers?.['user-agent'] || '';
    try {
      const result = await this.authService.login(dto.email, dto.password, { ip, ua });
      this._auditAsync(AuditAction.TENANT_LOGIN, req, result.user.id, result.user.email, result.user.tenantId, { method: 'email' });
      if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
      return result;
    } catch (error: unknown) {
      // 🔐 تسجيل محاولات الدخول الفاشلة
      const message = getErrorMessage(error);
      const reason = message.includes('قفل') ? 'account_locked'
        : message.includes('غير مفعّل') ? 'account_inactive'
        : message.includes('مسجّل عبر') ? 'no_password'
        : 'wrong_password';
      this.eventEmitter.emit('audit.login.failed', {
        email: dto.email,
        reason,
        ipAddress: ip,
        userAgent: ua,
      });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 REGISTER
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تسجيل حساب جديد' })
  @ApiResponse({ status: 201 })
  async register(@Body() dto: RegisterDto, @Request() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    this.logger.log(`Register attempt: ${this.maskEmail(dto.email)}`);
    const result = await this.authService.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      storeName: dto.storeName,
    });
    this._trackDeviceAsync(result?.user?.id, result, req);
    this._auditAsync(AuditAction.TENANT_REGISTER, req, result.user.id, result.user.email, result.user.tenantId, { storeName: dto.storeName });
    if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧 EMAIL OTP
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('otp/send-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إرسال رمز تحقق عبر الإيميل' })
  async sendEmailOtp(@Body() dto: SendEmailOtpDto): Promise<{ message: string; expiresAt: Date }> {
    return this.authService.sendEmailOtp(dto.email);
  }

  @Post('otp/verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من رمز الإيميل وتسجيل الدخول' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto, @Request() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    const result = await this.authService.verifyEmailOtp(dto.email, dto.otp);
    this._trackDeviceAsync(result?.user?.id, result, req);
    if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔵 GOOGLE OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('google/url')
  async getGoogleAuthUrl(@Res({ passthrough: true }) res: Response): Promise<{ url: string }> {
    const state = await this.oauthStateService.create('google');
    this.setOAuthStateCookie(res, state);
    return { url: this.authService.getGoogleAuthUrl(state) };
  }

  @Post('google/callback')
  @HttpCode(HttpStatus.OK)
  async googleCallback(
    @Body() dto: OAuthCallbackDto,
    @Request() req: OAuthCallbackRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    try {
      if (!dto.state || dto.state !== req.cookies?.[AuthController.OAUTH_STATE_COOKIE]) {
        throw new UnauthorizedException('جلسة تفويض Google غير صالحة أو منتهية');
      }
      await this.oauthStateService.consume(dto.state, 'google');
    } finally {
      this.clearOAuthStateCookie(res);
    }
    const result = await this.authService.googleAuthCode(dto.code);
    this._trackDeviceAsync(result?.user?.id, result, req);
    if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🟢 SALLA OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('salla/url')
  @ApiOperation({ summary: 'الحصول على رابط تسجيل الدخول عبر سلة' })
  async getSallaAuthUrl(@Res({ passthrough: true }) res: Response): Promise<{ url: string }> {
    const state = await this.oauthStateService.create('salla');
    this.setOAuthStateCookie(res, state);
    return { url: this.authService.getSallaAuthUrl(state) };
  }

  @Post('salla/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'معالجة callback من سلة' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async sallaCallback(@Body() dto: OAuthCallbackDto, @Request() req: OAuthCallbackRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    try {
      if (!dto.state || dto.state !== req.cookies?.[AuthController.OAUTH_STATE_COOKIE]) {
        throw new UnauthorizedException('جلسة تفويض OAuth غير صالحة أو منتهية');
      }
      await this.oauthStateService.consume(dto.state, 'salla');
    } finally {
      this.clearOAuthStateCookie(res);
    }
    const result = await this.authService.sallaAuth(dto.code);
    this._trackDeviceAsync(result?.user?.id, result, req);
    this._auditAsync(AuditAction.TENANT_SALLA_LOGIN, req, result.user.id, result.user.email, result.user.tenantId, { method: 'salla_oauth' });
    if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🟣 ZID OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('zid/url')
  @ApiOperation({ summary: 'الحصول على رابط تسجيل الدخول عبر زد' })
  async getZidAuthUrl(@Res({ passthrough: true }) res: Response): Promise<{ url: string }> {
    const state = await this.oauthStateService.create('zid');
    this.setOAuthStateCookie(res, state);
    return { url: this.authService.getZidAuthUrl(state) };
  }

  @Post('zid/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'معالجة callback من زد' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async zidCallback(@Body() dto: OAuthCallbackDto, @Request() req: OAuthCallbackRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResponseDto> {
    try {
      if (!dto.state || dto.state !== req.cookies?.[AuthController.OAUTH_STATE_COOKIE]) {
        throw new UnauthorizedException('جلسة تفويض OAuth غير صالحة أو منتهية');
      }
      await this.oauthStateService.consume(dto.state, 'zid');
    } finally {
      this.clearOAuthStateCookie(res);
    }
    const result = await this.authService.zidAuth(dto.code);
    this._trackDeviceAsync(result?.user?.id, result, req);
    this._auditAsync(AuditAction.TENANT_ZID_LOGIN, req, result.user.id, result.user.email, result.user.tenantId, { method: 'zid_oauth' });
    if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 SET PASSWORD (OAuth/OTP users)
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('set-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تعيين كلمة مرور جديدة (للمستخدمين بدون كلمة مرور)' })
  async setPassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: SetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.setPassword(this.authenticatedUserId(req), dto.password);
    this._auditAsync(AuditAction.TENANT_PASSWORD_CHANGED, req, undefined, undefined, undefined, { method: 'set_password' });
    return { message: 'تم تعيين كلمة المرور بنجاح' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تجديد التوكن' })
  @ApiResponse({ status: 200, type: RefreshTokenResponseDto })
  async refreshToken(
    @Body() dto: RefreshTokenDto,
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshTokenResponseDto> {
    // 🔒 FIX F-07: الكوكي أولاً (httpOnly، لا يقرؤه JS)، مع الرجوع للجسم للتوافق
    const cookieToken = req.cookies?.[AuthController.REFRESH_COOKIE];
    const refreshToken = cookieToken || dto?.refreshToken;
    if (!refreshToken) {
      this.clearRefreshCookie(res);
      throw new NotFoundException('توكن التجديد غير موجود');
    }
    let result: RefreshTokenResponseDto;
    try {
      result = await this.authService.refreshTokens(refreshToken);
    } catch (err) {
      // فشل التجديد (توكن مُبطَل/منتهٍ) → امسح الكوكي الميّت فلا يبقى في المتصفح
      this.clearRefreshCookie(res);
      throw err;
    }
    // تدوير الكوكي بالتوكن الجديد
    if (result?.refreshToken) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الخروج' })
  async logout(@Request() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<MessageResponseDto> {
    const userId = this.authenticatedUserId(req);
    const accessToken = req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    const refreshToken = req.cookies?.[AuthController.REFRESH_COOKIE];
    // حساب مدة الجلسة من JWT iat
    let sessionMinutes: number | undefined;
    try {
      if (accessToken) {
        const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
        if (payload.iat) sessionMinutes = Math.round((Date.now() / 1000 - payload.iat) / 60);
      }
    } catch {
      // The JWT guard has already authenticated the request; this only omits optional audit duration.
      this.logger.debug('Could not derive logout session duration from access token');
    }
    this._auditAsync(AuditAction.TENANT_LOGOUT, req, undefined, undefined, undefined, {
      ...(sessionMinutes !== undefined && { sessionDuration: `${sessionMinutes} دقيقة` }),
      ...(sessionMinutes !== undefined && { sessionMinutes }),
    });
    // The guard returns the User entity, not the JWT payload, so req.user.jti is
    // unavailable here. Pass the actual tokens and let AuthService extract and
    // revoke their signed jti values. The refresh token comes from the httpOnly
    // cookie and therefore cannot be supplied reliably by browser JavaScript.
    try {
      await this.authService.logout(userId, accessToken, refreshToken);
    } finally {
      // Always clear the browser cookie, even if the revocation store is
      // temporarily unavailable. The response can still report that failure.
      this.clearRefreshCookie(res);
    }
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 GET CURRENT USER
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'معلومات المستخدم الحالي' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async getMe(@Request() req: AuthenticatedRequest): Promise<UserProfileDto> {
    return this.authService.getUserProfile(this.authenticatedUserId(req));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تغيير كلمة المرور' })
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(this.authenticatedUserId(req), dto.currentPassword, dto.newPassword);
    this._auditAsync(AuditAction.TENANT_PASSWORD_CHANGED, req);
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 FORGOT PASSWORD - استعادة كلمة المرور
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'طلب استعادة كلمة المرور' })
  @ApiResponse({ status: 200, description: 'تم إرسال رابط الاستعادة (إذا كان الإيميل مسجلاً)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Request() req: AuthenticatedRequest): Promise<MessageResponseDto> {
    this.logger.log(`Forgot password request: ${this.maskEmail(dto.email)}`);
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    this.eventEmitter.emit('audit.password.reset_requested', { email: dto.email, ipAddress: ip, userAgent: req.headers?.['user-agent'] || '' });
    return this.authService.forgotPassword(dto.email);
  }

  @Post('verify-reset-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من صلاحية رابط استعادة كلمة المرور' })
  @ApiResponse({ status: 200, description: 'صلاحية الرابط' })
  async verifyResetToken(@Body() dto: VerifyResetTokenDto): Promise<{ valid: boolean }> {
    return this.authService.verifyResetToken(dto.token, dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تحديث كلمة المرور عبر رابط الاستعادة' })
  @ApiResponse({ status: 200, description: 'تم تحديث كلمة المرور بنجاح' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    this.logger.log(`Reset password attempt: ${this.maskEmail(dto.email)}`);
    return this.authService.resetPassword(dto.token, dto.email, dto.newPassword);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 TRUSTED DEVICES
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'قائمة الأجهزة الموثوقة' })
  async getDevices(@Request() req: AuthenticatedRequest) {
    const userId = this.authenticatedUserId(req);
    const currentIp = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const currentUA = req.headers?.['user-agent'] || '';
    return this.authService.getDevices(userId, currentIp, currentUA);
  }

  @Delete('devices/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'إلغاء ثقة جهاز' })
  async revokeDevice(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = this.authenticatedUserId(req);
    const ok = await this.authService.revokeDevice(userId, id);
    if (!ok) throw new NotFoundException('الجهاز غير موجود');
    return { message: 'تم إلغاء الثقة' };
  }

  @Delete('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'تسجيل الخروج من جميع الأجهزة' })
  async revokeAllDevices(@Request() req: AuthenticatedRequest) {
    const userId = this.authenticatedUserId(req);
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const count = await this.authService.revokeAllDevices(userId, ip);
    return { message: `تم تسجيل الخروج من ${count} جهاز` };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 PRIVATE HELPER — تتبع الجهاز بعد أي نوع من تسجيل الدخول
  // ═══════════════════════════════════════════════════════════════════════════════

  private _trackDeviceAsync(userId: string | undefined, result: LoginResult, req: AuthenticatedRequest): void {
    if (!userId) return;
    const tenantId = result?.user?.tenantId || '';
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const ua = req.headers?.['user-agent'] || '';
    this.authService.trackDevice(userId, tenantId, { ip, userAgent: ua })
      .catch((error: unknown) => this.logger.warn(`Device tracking failed: ${getErrorMessage(error)}`));
  }

  private authenticatedUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) throw new UnauthorizedException('جلسة المستخدم غير صالحة');
    return userId;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📋 PRIVATE HELPER — تسجيل أحداث التاجر في سجل التدقيق (fire-and-forget)
  // ═══════════════════════════════════════════════════════════════════════════════

  private _auditAsync(
    action: AuditAction,
    req: AuthenticatedRequest,
    userId?: string,
    email?: string,
    tenantId?: string,
    meta?: Record<string, unknown>,
  ): void {
    const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    const ua = req.headers?.['user-agent'] || '';
    this.auditService.logTenant({
      actorId: userId || req.user?.sub || req.user?.id || '00000000-0000-0000-0000-000000000000',
      actorEmail: email || req.user?.email || 'unknown',
      tenantId: tenantId || req.user?.tenantId || undefined,
      action,
      targetType: 'auth',
      metadata: meta || {},
      ipAddress: ip,
      userAgent: ua,
    }).catch((error: unknown) => this.logger.warn(`Audit log failed: ${getErrorMessage(error)}`));
  }
}
