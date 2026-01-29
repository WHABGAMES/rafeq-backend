/**
 * RAFIQ PLATFORM - Auth Controller
 * 
 * Endpoints:
 * POST /api/auth/login      → تسجيل الدخول
 * POST /api/auth/register   → إنشاء حساب جديد
 * POST /api/auth/refresh    → تجديد الـ Token
 * POST /api/auth/logout     → تسجيل الخروج
 * GET  /api/auth/me         → بيانات المستخدم الحالي
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
}
