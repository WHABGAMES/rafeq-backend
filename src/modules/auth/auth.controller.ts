/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Controller                             ║
 * ║                                                                                ║
 * ║  ✅ v5: Security Fixes                                                         ║
 * ║  🔧 FIX H4: استخدام RegisterDto بدل raw Body                                  ║
 * ║  🔧 FIX M3: إخفاء الإيميل في الـ Logs                                         ║
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
  RegisterDto, // 🔧 FIX H4
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

  // 🔧 FIX M3: إخفاء الإيميل
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***@***';
    const masked = local.length <= 2
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
    return `${masked}@${domain}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 REGISTER
  // 🔧 FIX H4: استخدام RegisterDto مع تحقق كامل
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'تسجيل حساب جديد',
    description: 'إنشاء حساب جديد بالبريد الإلكتروني وكلمة المرور',
  })
  @ApiResponse({ status: 201, description: 'تم إنشاء الحساب بنجاح' })
  @ApiResponse({ status: 409, description: 'البريد الإلكتروني مسجل مسبقاً' })
  async register(
    @Body() dto: RegisterDto, // 🔧 FIX H4: DTO بدل raw object
  ): Promise<LoginResponseDto> {
    this.logger.log(`Register attempt: ${this.maskEmail(dto.email)}`);

    const result = await this.authService.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      storeName: dto.storeName,
    });

    this.logger.log(`✅ Registration successful: ${this.maskEmail(dto.email)}`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 LOGIN
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تسجيل الدخول',
    description: 'تسجيل الدخول بالبريد الإلكتروني ورمز الدخول',
  })
  @ApiResponse({ status: 200, description: 'تم تسجيل الدخول بنجاح', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    this.logger.log(`Login attempt: ${this.maskEmail(loginDto.email)}`);
    const result = await this.authService.login(loginDto.email, loginDto.password);
    this.logger.log(`✅ Login successful: ${this.maskEmail(loginDto.email)}`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تجديد التوكن' })
  @ApiResponse({ status: 200, description: 'تم تجديد التوكن بنجاح', type: RefreshTokenResponseDto })
  async refreshToken(@Body() dto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT
  // 🔧 FIX C4: تمرير JTI للـ blacklist
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل الخروج' })
  async logout(@Request() req: any): Promise<MessageResponseDto> {
    await this.authService.logout(
      req.user.sub,
      req.user.jti,        // 🔧 FIX C4: access token JTI
      req.body?.refreshJti, // optional: refresh token JTI
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
  @ApiResponse({ status: 200, description: 'بيانات المستخدم', type: UserProfileDto })
  async getMe(@Request() req: any): Promise<UserProfileDto> {
    return this.authService.getUserProfile(req.user.sub);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تغيير كلمة المرور' })
  @ApiResponse({ status: 200, description: 'تم تغيير كلمة المرور بنجاح' })
  async changePassword(
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(req.user.sub, dto.currentPassword, dto.newPassword);
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }
}
