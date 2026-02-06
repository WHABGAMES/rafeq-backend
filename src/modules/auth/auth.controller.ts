/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Controller                             ║
 * ║                                                                                ║
 * ║  ✅ v6: Multi-Auth Support                                                     ║
 * ║  POST /auth/check-email     → التحقق من وجود الإيميل                          ║
 * ║  POST /auth/login           → Email + Password                                ║
 * ║  POST /auth/register        → تسجيل حساب جديد                                ║
 * ║  POST /auth/otp/send        → إرسال OTP عبر الإيميل                           ║
 * ║  POST /auth/otp/verify      → التحقق من OTP                                   ║
 * ║  POST /auth/google          → Google OAuth                                    ║
 * ║  GET  /auth/salla/url       → Salla OAuth URL                                ║
 * ║  POST /auth/salla/callback  → Salla OAuth Callback                            ║
 * ║  GET  /auth/zid/url         → Zid OAuth URL                                  ║
 * ║  POST /auth/zid/callback    → Zid OAuth Callback                              ║
 * ║  POST /auth/set-password    → تعيين كلمة مرور (OAuth/OTP users)               ║
 * ║  POST /auth/refresh         → تجديد التوكن                                    ║
 * ║  POST /auth/logout          → تسجيل الخروج                                   ║
 * ║  GET  /auth/me              → بيانات المستخدم الحالي                           ║
 * ║  POST /auth/change-password → تغيير كلمة المرور                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

import {
  LoginDto,
  LoginResponseDto,
  RegisterDto,
  CheckEmailDto,
  CheckEmailResponseDto,
  SendEmailOtpDto,
  VerifyEmailOtpDto,
  GoogleAuthDto,
  SallaAuthDto,
  ZidAuthDto,
  SetPasswordDto,
  RefreshTokenDto,
  RefreshTokenResponseDto,
  ChangePasswordDto,
  MessageResponseDto,
  UserProfileDto,
} from './dto';

@ApiTags('🔐 Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

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
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    this.logger.log(`Login attempt: ${this.maskEmail(dto.email)}`);
    return this.authService.login(dto.email, dto.password);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 REGISTER
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تسجيل حساب جديد' })
  @ApiResponse({ status: 201 })
  async register(@Body() dto: RegisterDto): Promise<LoginResponseDto> {
    this.logger.log(`Register attempt: ${this.maskEmail(dto.email)}`);
    return this.authService.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      storeName: dto.storeName,
    });
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
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto): Promise<LoginResponseDto> {
    return this.authService.verifyEmailOtp(dto.email, dto.otp);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔵 GOOGLE OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الدخول عبر Google' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async googleAuth(@Body() dto: GoogleAuthDto): Promise<LoginResponseDto> {
    return this.authService.googleAuth(dto.idToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🟢 SALLA OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('salla/url')
  @ApiOperation({ summary: 'الحصول على رابط تسجيل الدخول عبر سلة' })
  getSallaAuthUrl(): { url: string } {
    return { url: this.authService.getSallaAuthUrl() };
  }

  @Post('salla/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'معالجة callback من سلة' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async sallaCallback(@Body() dto: SallaAuthDto): Promise<LoginResponseDto> {
    return this.authService.sallaAuth(dto.code, dto.state);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🟣 ZID OAuth
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('zid/url')
  @ApiOperation({ summary: 'الحصول على رابط تسجيل الدخول عبر زد' })
  getZidAuthUrl(): { url: string } {
    return { url: this.authService.getZidAuthUrl() };
  }

  @Post('zid/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'معالجة callback من زد' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async zidCallback(@Body() dto: ZidAuthDto): Promise<LoginResponseDto> {
    return this.authService.zidAuth(dto.code, dto.state);
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
    @Request() req: any,
    @Body() dto: SetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.setPassword(req.user.sub || req.user.id, dto.password);
    return { message: 'تم تعيين كلمة المرور بنجاح' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تجديد التوكن' })
  @ApiResponse({ status: 200, type: RefreshTokenResponseDto })
  async refreshToken(@Body() dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الخروج' })
  async logout(@Request() req: any): Promise<MessageResponseDto> {
    await this.authService.logout(
      req.user.sub || req.user.id,
      req.user.jti,
      req.body?.refreshJti,
    );
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
  async getMe(@Request() req: any): Promise<UserProfileDto> {
    return this.authService.getUserProfile(req.user.sub || req.user.id);
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
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(req.user.sub || req.user.id, dto.currentPassword, dto.newPassword);
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }
}
