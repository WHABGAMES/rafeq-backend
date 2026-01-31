/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ - Salla OAuth Controller                                  ║
 * ║                                                                                ║
 * ║  ✅ POST /connect - مع JwtAuthGuard - يرجع { redirectUrl }                    ║
 * ║  ✅ GET /callback - بدون Guard - يعالج الـ OAuth callback                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';

// ✅ Guards
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Services
import { SallaOAuthService } from './salla-oauth.service';

// DTOs
import { SallaConnectDto } from './dto/salla-connect.dto';
import { SallaCallbackDto } from './dto/salla-callback.dto';

// ✅ لا يوجد UnauthorizedException - لأننا نستخدم JwtAuthGuard

@Controller('stores/salla')
export class SallaOAuthController {
  private readonly logger = new Logger(SallaOAuthController.name);

  constructor(
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * ✅ POST /stores/salla/connect
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * - محمي بـ JwtAuthGuard (يتطلب تسجيل دخول)
   * - يستقبل state من الـ Frontend للحماية من CSRF
   * - يرجع { redirectUrl } فقط
   * - لا يرجع store_id أو أي بيانات حساسة
   */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  async connect(
    @Body() dto: SallaConnectDto,
    @Req() req: Request,
  ): Promise<{ redirectUrl: string }> {
    const user = req.user as { id: string; tenantId: string };

    this.logger.log(`OAuth connect initiated`, {
      userId: user.id,
      tenantId: user.tenantId,
      hasState: !!dto.state,
    });

    // توليد رابط التفويض
    const redirectUrl = this.sallaOAuthService.generateAuthorizationUrl(
      user.tenantId,
      dto.state,
    );

    // ✅ يرجع { redirectUrl } فقط
    return { redirectUrl };
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * ✅ GET /stores/salla/callback
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * - ❌ بدون Guard - لأن سلة ترسل الـ callback
   * - يعالج الـ OAuth callback من سلة
   * - يستبدل الـ code بـ tokens
   * - يحفظ المتجر في قاعدة البيانات
   * - يعيد توجيه المستخدم للـ Frontend مع status فقط
   */
  @Get('callback')
  async callback(
    @Query() query: SallaCallbackDto,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'https://rafeq.ai');
    const redirectPath = '/dashboard/stores';

    try {
      this.logger.log(`OAuth callback received`, {
        hasCode: !!query.code,
        hasState: !!query.state,
        hasError: !!query.error,
      });

      // التحقق من الأخطاء من سلة
      if (query.error) {
        this.logger.warn(`OAuth error from Salla: ${query.error}`);
        return res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=${query.error}`,
        );
      }

      // التحقق من وجود code
      if (!query.code) {
        this.logger.warn('OAuth callback missing code');
        return res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=missing_code`,
        );
      }

      // استبدال الـ code بـ tokens وحفظ المتجر
      const result = await this.sallaOAuthService.exchangeCodeForTokens(
        query.code,
        query.state,
      );

      this.logger.log(`OAuth completed successfully`, {
        storeId: result.store.id,
        merchantId: result.store.merchantId,
      });

      // ✅ توجيه مع status فقط - لا store_id
      return res.redirect(
        `${frontendUrl}${redirectPath}?status=success&state=${query.state || ''}`,
      );

    } catch (error) {
      this.logger.error(`OAuth callback error`, {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.redirect(
        `${frontendUrl}${redirectPath}?status=error&reason=connection_failed`,
      );
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * GET /stores/salla/status
   * ═══════════════════════════════════════════════════════════════════════════════
   * 
   * - محمي بـ JwtAuthGuard
   * - يرجع حالة الربط للـ tenant
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: Request): Promise<{
    connected: boolean;
    storeCount: number;
  }> {
    const user = req.user as { tenantId: string };
    
    const status = await this.sallaOAuthService.getConnectionStatus(user.tenantId);
    
    return status;
  }
}
