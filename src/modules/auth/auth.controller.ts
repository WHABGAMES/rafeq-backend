/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Controller (Simplified)              ║
 * ║                                                                                ║
 * ║  🎯 نظام المصادقة المبسط:                                                      ║
 * ║  - تسجيل دخول بالإيميل + الباسورد فقط                                          ║
 * ║  - لا OTP                                                                      ║
 * ║  - الحساب يُنشأ تلقائياً عند تثبيت التطبيق من سلة                               ║
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

// DTOs
import {
  LoginDto,
  LoginResponseDto,
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 LOGIN - Email + Password
  // ═══════════════════════════════════════════════════════════════════════════════
  
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تسجيل الدخول',
    description: 'تسجيل الدخول بالبريد الإلكتروني ورمز الدخول',
  })
  @ApiResponse({
    status: 200,
    description: 'تم تسجيل الدخول بنجاح',
    type: LoginResponseDto,
  })
  @ApiResponse({ status: 401, description: 'بيانات الدخول غير صحيحة' })
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    this.logger.log(`Login attempt: ${loginDto.email}`);
    
    const result = await this.authService.login(loginDto.email, loginDto.password);
    
    this.logger.log(`✅ Login successful: ${loginDto.email}`);
    
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════════════════════════
  
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تجديد التوكن',
    description: 'تجديد access token باستخدام refresh token',
  })
  @ApiResponse({
    status: 200,
    description: 'تم تجديد التوكن بنجاح',
    type: RefreshTokenResponseDto,
  })
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
  @ApiOperation({
    summary: 'تسجيل الخروج',
    description: 'تسجيل خروج المستخدم وإبطال التوكن',
  })
  async logout(@Request() req: any): Promise<MessageResponseDto> {
    await this.authService.logout(req.user.sub);
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 GET CURRENT USER
  // ═══════════════════════════════════════════════════════════════════════════════
  
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'معلومات المستخدم الحالي',
    description: 'جلب بيانات المستخدم المسجل حالياً',
  })
  @ApiResponse({
    status: 200,
    description: 'بيانات المستخدم',
    type: UserProfileDto,
  })
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
  @ApiOperation({
    summary: 'تغيير كلمة المرور',
    description: 'تغيير كلمة المرور للمستخدم الحالي',
  })
  @ApiResponse({ status: 200, description: 'تم تغيير كلمة المرور بنجاح' })
  async changePassword(
    @Request() req: any,
    @Body() dto: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(
      req.user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }
}
