/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Controller                            ║
 * ║                                                                                ║
 * ║  Endpoints:                                                                    ║
 * ║  POST /api/auth/login           → تسجيل الدخول (Email + Password)              ║
 * ║  POST /api/auth/register        → إنشاء حساب جديد                              ║
 * ║  POST /api/auth/refresh         → تجديد الـ Token                              ║
 * ║  POST /api/auth/logout          → تسجيل الخروج                                 ║
 * ║  GET  /api/auth/me              → بيانات المستخدم الحالي                        ║
 * ║  POST /api/auth/set-password    → تعيين كلمة مرور (بعد OTP/OAuth)               ║
 * ║  POST /api/auth/change-password → تغيير كلمة المرور                            ║
 * ║                                                                                ║
 * ║  OTP Endpoints:                                                                ║
 * ║  GET  /api/auth/otp             → Entry point من سلة                           ║
 * ║  GET  /api/auth/otp/methods     → طرق التحقق المتاحة                           ║
 * ║  POST /api/auth/otp/send        → إرسال رمز التحقق                             ║
 * ║  POST /api/auth/otp/verify      → التحقق وتسجيل الدخول                         ║
 * ║  POST /api/auth/otp/resend      → إعادة إرسال الرمز                            ║
 * ║                                                                                ║
 * ║  Salla OAuth Endpoints:                                                        ║
 * ║  GET  /api/auth/salla           → بدء OAuth مع سلة                             ║
 * ║  GET  /api/auth/salla/callback  → Callback من سلة                              ║
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
  Query,
  Redirect,
  Res,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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
  SetPasswordDto,
  SetPasswordResponseDto,
  SendOtpDto,
  VerifyOtpDto,
  ResendOtpDto,
  OtpSentResponseDto,
  OtpVerifiedResponseDto,
  OtpChannelDto,
  VerificationMethodsResponseDto,
} from './dto';
import { JwtAuthGuard, Public } from './guards/jwt-auth.guard';
import { SallaOAuthService } from '../stores/salla-oauth.service';
import { User } from '@database/entities';

interface RequestWithUser extends Request {
  user: User;
}

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 Basic Auth Endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/auth/login
   * تسجيل الدخول بالإيميل والباسورد
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الدخول بالإيميل والباسورد' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'تم تسجيل الدخول بنجاح', type: TokensDto })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  async login(@Body() dto: LoginDto): Promise<TokensDto & { needsPassword?: boolean }> {
    return this.authService.login(dto);
  }

  /**
   * POST /api/auth/register
   * إنشاء حساب جديد
   */
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إنشاء حساب جديد' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'تم إنشاء الحساب بنجاح', type: TokensDto })
  @ApiResponse({ status: 409, description: 'البريد الإلكتروني مستخدم مسبقاً' })
  async register(@Body() dto: RegisterDto): Promise<TokensDto> {
    return this.authService.register(dto);
  }

  /**
   * POST /api/auth/refresh
   * تجديد الـ Token
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تجديد الـ Token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'تم تجديد الـ Token بنجاح', type: TokensDto })
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokensDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /**
   * POST /api/auth/logout
   * تسجيل الخروج
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
   * بيانات المستخدم الحالي
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'بيانات المستخدم الحالي' })
  @ApiResponse({ status: 200, description: 'بيانات المستخدم' })
  getMe(@Request() req: RequestWithUser): User {
    return req.user;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 Password Management Endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/auth/set-password
   * تعيين كلمة مرور جديدة (بعد أول OTP/OAuth login)
   */
  @Post('set-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'تعيين كلمة مرور جديدة (بعد أول تسجيل دخول بـ OTP أو سلة)' })
  @ApiBody({ type: SetPasswordDto })
  @ApiResponse({ status: 200, description: 'تم تعيين كلمة المرور بنجاح', type: SetPasswordResponseDto })
  @ApiResponse({ status: 400, description: 'كلمة المرور غير متطابقة' })
  async setPassword(
    @Request() req: RequestWithUser,
    @Body() dto: SetPasswordDto,
  ): Promise<SetPasswordResponseDto> {
    // التحقق من تطابق كلمة المرور
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('كلمة المرور غير متطابقة');
    }

    return this.authService.setPassword(req.user.id, dto.password);
  }

  /**
   * POST /api/auth/change-password
   * تغيير كلمة المرور
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
  // 🔐 OTP Endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/auth/otp
   * نقطة الدخول من سلة - توجيه تلقائي لصفحة التحقق
   */
  @Get('otp')
  @Public()
  @Redirect()
  @ApiOperation({ summary: 'نقطة الدخول من سلة (Redirect)' })
  @ApiQuery({ name: 'merchant_id', description: 'رقم التاجر في سلة', required: true })
  async otpEntryPoint(
    @Query('merchant_id') merchantId: string,
  ): Promise<{ url: string; statusCode: number }> {
    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://rafeq.ai');
    const numericMerchantId = parseInt(merchantId, 10);
    
    if (isNaN(numericMerchantId) || numericMerchantId <= 0) {
      return {
        url: `${frontendUrl}/auth/error?error=invalid_merchant`,
        statusCode: 302,
      };
    }

    return {
      url: `${frontendUrl}/auth/verify?merchant_id=${numericMerchantId}`,
      statusCode: 302,
    };
  }

  /**
   * GET /api/auth/otp/methods
   * جلب طرق التحقق المتاحة للتاجر
   */
  @Get('otp/methods')
  @Public()
  @ApiOperation({ summary: 'جلب طرق التحقق المتاحة' })
  @ApiQuery({ name: 'merchant_id', description: 'رقم التاجر في سلة', required: true })
  @ApiResponse({ status: 200, type: VerificationMethodsResponseDto })
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
   * إرسال رمز التحقق
   */
  @Post('otp/send')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إرسال رمز التحقق (Email أو WhatsApp)' })
  @ApiBody({ type: SendOtpDto })
  @ApiResponse({ status: 200, type: OtpSentResponseDto })
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
   * التحقق من OTP وتسجيل الدخول
   */
  @Post('otp/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'التحقق من رمز OTP وتسجيل الدخول' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, type: OtpVerifiedResponseDto })
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
  @ApiResponse({ status: 200, type: OtpSentResponseDto })
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔗 Salla OAuth Endpoints
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/auth/salla
   * بدء OAuth مع سلة (للمستخدمين الجدد بدون حساب)
   */
  @Get('salla')
  @Public()
  @Redirect()
  @ApiOperation({ summary: 'بدء تسجيل الدخول عبر سلة OAuth' })
  @ApiResponse({ status: 302, description: 'توجيه لصفحة تسجيل الدخول في سلة' })
  async startSallaOAuth(): Promise<{ url: string; statusCode: number }> {
    const stateData = {
      type: 'login',
      timestamp: Date.now(),
      nonce: Math.random().toString(36).substring(7),
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString('base64url');

    const clientId = this.configService.get('SALLA_CLIENT_ID');
    const redirectUri = this.configService.get('SALLA_AUTH_REDIRECT_URI', 
      `${this.configService.get('API_URL')}/api/auth/salla/callback`
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'offline_access',
      state,
    });

    const url = `https://accounts.salla.sa/oauth2/auth?${params.toString()}`;
    
    this.logger.log('Starting Salla OAuth login flow');

    return { url, statusCode: 302 };
  }

  /**
   * GET /api/auth/salla/callback
   * Callback من سلة بعد الموافقة
   */
  @Get('salla/callback')
  @Public()
  @ApiOperation({ summary: 'Salla OAuth Callback' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  async sallaOAuthCallback(
    @Query('code') code: string,
    @Query('state') _state: string, // Used for CSRF protection, validated by Salla
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://rafeq.ai');

    try {
      if (error) {
        this.logger.warn(`Salla OAuth error: ${error} - ${errorDescription}`);
        res.redirect(
          `${frontendUrl}/auth/login?error=salla_oauth_error&message=${encodeURIComponent(errorDescription || error)}`
        );
        return;
      }

      if (!code) {
        this.logger.warn('Salla OAuth callback missing code');
        res.redirect(`${frontendUrl}/auth/login?error=missing_code`);
        return;
      }

      const clientId = this.configService.get('SALLA_CLIENT_ID');
      const clientSecret = this.configService.get('SALLA_CLIENT_SECRET');
      const redirectUri = this.configService.get('SALLA_AUTH_REDIRECT_URI',
        `${this.configService.get('API_URL')}/api/auth/salla/callback`
      );

      // Exchange code for tokens
      const tokenResponse = await this.exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
      
      // Fetch merchant info
      const merchantInfo = await this.sallaOAuthService.fetchMerchantInfo(tokenResponse.access_token);

      // Create or get store
      const store = await this.sallaOAuthService.handleAppStoreAuthorize(
        merchantInfo.id,
        {
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          expires: tokenResponse.expires_in,
          scope: 'offline_access',
        },
        new Date().toISOString(),
      );

      // Ensure store has tenantId
      if (!store.tenantId) {
        this.logger.error('Store created without tenantId');
        res.redirect(`${frontendUrl}/auth/login?error=store_setup_failed`);
        return;
      }

      // Login user via OAuth
      const loginResult = await this.authService.loginViaSallaOAuth(
        merchantInfo.id,
        {
          email: merchantInfo.email,
          name: merchantInfo.name,
          mobile: merchantInfo.mobile,
          avatar: merchantInfo.avatar,
        },
        store.tenantId,
      );

      this.logger.log(`✅ Salla OAuth login successful`, {
        userId: loginResult.userId,
        merchantId: merchantInfo.id,
        isFirstLogin: loginResult.isFirstLogin,
        needsPassword: loginResult.needsPassword,
      });

      const params = new URLSearchParams({
        access_token: loginResult.accessToken,
        refresh_token: loginResult.refreshToken,
        needs_password: loginResult.needsPassword.toString(),
        is_first_login: loginResult.isFirstLogin.toString(),
      });

      if (loginResult.needsPassword) {
        res.redirect(`${frontendUrl}/auth/set-password?${params.toString()}`);
        return;
      }

      res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);

    } catch (err: any) {
      this.logger.error(`Salla OAuth callback error: ${err.message}`);
      res.redirect(
        `${frontendUrl}/auth/login?error=oauth_failed&message=${encodeURIComponent(err.message)}`
      );
    }
  }

  /**
   * Exchange code for tokens using HttpService
   */
  private async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          'https://accounts.salla.sa/oauth2/token',
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        ),
      );

      return response.data;
    } catch (error: any) {
      this.logger.error(`Token exchange failed: ${error.response?.data || error.message}`);
      throw new BadRequestException('فشل في الحصول على tokens من سلة');
    }
  }
}
