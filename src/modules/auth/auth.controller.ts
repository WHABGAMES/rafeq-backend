/**
 * RAFIQ PLATFORM - Auth Controller
 * 
 * Endpoints:
 * POST /api/auth/login      → تسجيل الدخول
 * POST /api/auth/register   → إنشاء حساب جديد
 * POST /api/auth/refresh    → تجديد الـ Token
 * POST /api/auth/logout     → تسجيل الخروج
 * GET  /api/auth/me         → بيانات المستخدم الحالي
 * 
 * OTP Endpoints (للدخول من سلة - متعدد القنوات):
 * GET  /api/auth/otp/methods → طرق التحقق المتاحة
 * POST /api/auth/otp/send    → إرسال رمز التحقق (Email/WhatsApp)
 * POST /api/auth/otp/verify  → التحقق من الرمز وتسجيل الدخول
 * POST /api/auth/otp/resend  → إعادة إرسال الرمز
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
  Query,
  Redirect,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  TokensDto,
  ChangePasswordDto,
  SendOtpDto,
  VerifyOtpDto,
  ResendOtpDto,
  OtpSentResponseDto,
  OtpVerifiedResponseDto,
  OtpChannelDto,
  VerificationMethodsResponseDto,
} from './dto';
import { JwtAuthGuard, Public } from './guards/jwt-auth.guard';
import { User } from '@database/entities';

interface RequestWithUser extends Request {
  user: User;
}

// ✅ Fixed: Removed version to work without global versioning
@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/login
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الدخول' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'تم تسجيل الدخول بنجاح', type: TokensDto })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  async login(@Body() dto: LoginDto): Promise<TokensDto> {
    return this.authService.login(dto);
  }

  /**
   * POST /api/auth/register
   */
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء حساب جديد' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'تم إنشاء الحساب بنجاح', type: TokensDto })
  @ApiResponse({ status: 400, description: 'البيانات غير صحيحة' })
  @ApiResponse({ status: 409, description: 'البريد الإلكتروني مستخدم مسبقاً' })
  async register(@Body() dto: RegisterDto): Promise<TokensDto> {
    return this.authService.register(dto);
  }

  /**
   * POST /api/auth/refresh
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تجديد الـ Token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'تم تجديد الـ Token بنجاح', type: TokensDto })
  @ApiResponse({ status: 401, description: 'الـ Refresh Token غير صالح' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokensDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /**
   * POST /api/auth/logout
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تسجيل الخروج' })
  @ApiResponse({ status: 200, description: 'تم تسجيل الخروج بنجاح' })
  async logout(@Request() req: RequestWithUser): Promise<{ message: string }> {
    await this.authService.logout(req.user.id);
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  /**
   * GET /api/auth/me
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'بيانات المستخدم الحالي' })
  @ApiResponse({ status: 200, description: 'بيانات المستخدم' })
  @ApiResponse({ status: 401, description: 'غير مصرح' })
  getMe(@Request() req: RequestWithUser): User {
    return req.user;
  }

  /**
   * POST /api/auth/change-password
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تغيير كلمة المرور' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'تم تغيير كلمة المرور بنجاح' })
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 OTP Endpoints - للدخول من سلة (متعدد القنوات: Email + WhatsApp)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/auth/otp
   * نقطة الدخول من سلة - توجيه تلقائي لصفحة اختيار طريقة التحقق
   * 
   * سلة ترسل التاجر هنا بعد تثبيت التطبيق:
   * https://api.rafeq.ai/api/auth/otp?merchant_id=426101474
   */
  @Get('otp')
  @Public()
  @Redirect()
  @ApiOperation({ summary: 'نقطة الدخول من سلة - Entry Point (Redirect)' })
  @ApiQuery({ name: 'merchant_id', description: 'رقم التاجر في سلة', required: true })
  @ApiResponse({ status: 302, description: 'توجيه لصفحة التحقق' })
  async otpEntryPoint(
    @Query('merchant_id') merchantId: string,
  ): Promise<{ url: string; statusCode: number }> {
    const frontendUrl = process.env.FRONTEND_URL || 'https://app.rafeq.ai';
    const numericMerchantId = parseInt(merchantId, 10);
    
    if (isNaN(numericMerchantId) || numericMerchantId <= 0) {
      return {
        url: `${frontendUrl}/auth/error?error=invalid_merchant`,
        statusCode: 302,
      };
    }

    // توجيه لصفحة اختيار طريقة التحقق
    return {
      url: `${frontendUrl}/auth/verify?merchant_id=${numericMerchantId}`,
      statusCode: 302,
    };
  }

  /**
   * GET /api/auth/otp/methods
   * جلب طرق التحقق المتاحة للتاجر (Email + WhatsApp)
   */
  @Get('otp/methods')
  @Public()
  @ApiOperation({ summary: 'جلب طرق التحقق المتاحة' })
  @ApiQuery({ name: 'merchant_id', description: 'رقم التاجر في سلة', required: true })
  @ApiResponse({ status: 200, description: 'طرق التحقق المتاحة', type: VerificationMethodsResponseDto })
  @ApiResponse({ status: 404, description: 'المتجر غير موجود' })
  async getVerificationMethods(
    @Query('merchant_id') merchantId: string,
  ): Promise<VerificationMethodsResponseDto> {
    const numericMerchantId = parseInt(merchantId, 10);
    
    if (isNaN(numericMerchantId) || numericMerchantId <= 0) {
      throw new BadRequestException('رقم التاجر غير صالح');
    }

    return this.authService.getVerificationMethods(numericMerchantId);
  }

  /**
   * POST /api/auth/otp/send
   * إرسال رمز التحقق للتاجر عبر القناة المختارة (Email أو WhatsApp)
   */
  @Post('otp/send')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إرسال رمز التحقق (Email أو WhatsApp)' })
  @ApiBody({ type: SendOtpDto })
  @ApiResponse({ status: 200, description: 'تم إرسال رمز التحقق', type: OtpSentResponseDto })
  @ApiResponse({ status: 404, description: 'المتجر غير موجود' })
  @ApiResponse({ status: 400, description: 'يرجى الانتظار قبل إعادة الإرسال' })
  async sendOtp(@Body() dto: SendOtpDto): Promise<OtpSentResponseDto> {
    const result = await this.authService.sendOtpToMerchant(
      dto.merchantId,
      dto.channel || OtpChannelDto.EMAIL,
    );
    
    return {
      success: result.success,
      message: result.message,
      channel: result.channel,
      maskedValue: result.maskedValue,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * POST /api/auth/otp/verify
   * التحقق من الرمز وتسجيل الدخول
   */
  @Post('otp/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من رمز OTP وتسجيل الدخول' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, description: 'تم التحقق بنجاح', type: OtpVerifiedResponseDto })
  @ApiResponse({ status: 401, description: 'رمز التحقق غير صحيح' })
  async verifyOtp(@Body() dto: VerifyOtpDto): Promise<OtpVerifiedResponseDto> {
    return this.authService.verifyOtpAndLogin(
      dto.merchantId,
      dto.otp,
      dto.channel || OtpChannelDto.EMAIL,
    );
  }

  /**
   * POST /api/auth/otp/resend
   * إعادة إرسال رمز التحقق
   */
  @Post('otp/resend')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إعادة إرسال رمز التحقق' })
  @ApiBody({ type: ResendOtpDto })
  @ApiResponse({ status: 200, description: 'تم إرسال رمز جديد', type: OtpSentResponseDto })
  @ApiResponse({ status: 400, description: 'يرجى الانتظار قبل إعادة الإرسال' })
  async resendOtp(@Body() dto: ResendOtpDto): Promise<OtpSentResponseDto> {
    const result = await this.authService.resendOtp(
      dto.identifier,
      dto.channel || OtpChannelDto.EMAIL,
      dto.merchantId,
    );
    
    return {
      success: result.success,
      message: result.message,
      channel: result.channel,
      maskedValue: result.maskedValue,
      expiresAt: result.expiresAt,
    };
  }
}
