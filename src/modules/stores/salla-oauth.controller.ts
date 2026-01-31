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
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';

// Guards
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Services
import { SallaOAuthService } from './salla-oauth.service';

// ✅ DTOs inline
interface SallaConnectDto {
  state?: string;
}

interface SallaCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

@Controller('stores/salla')
export class SallaOAuthController {
  private readonly logger = new Logger(SallaOAuthController.name);

  constructor(
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * ✅ POST /stores/salla/connect
   * يبدأ عملية OAuth مع سلة
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

    // ✅ generateAuthorizationUrl يقبل tenantId و state اختياري
    const redirectUrl = this.sallaOAuthService.generateAuthorizationUrl(
      user.tenantId,
      dto.state,
    );

    return { redirectUrl };
  }

  /**
   * ✅ GET /stores/salla/callback
   * يعالج الـ callback من سلة بعد موافقة المستخدم
   */
  @Get('callback')
  async callback(
    @Query() query: SallaCallbackQuery,
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

      // ✅ معالجة الأخطاء من سلة
      if (query.error) {
        this.logger.warn(`OAuth error from Salla: ${query.error}`);
        return res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=${query.error}`,
        );
      }

      // ✅ التحقق من وجود code
      if (!query.code) {
        this.logger.warn('OAuth callback missing code');
        return res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=missing_code`,
        );
      }

      // ✅ التحقق من وجود state
      if (!query.state) {
        this.logger.warn('OAuth callback missing state');
        return res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=missing_state`,
        );
      }

      // ✅ استبدال الـ code بـ tokens وإنشاء المتجر
      const result = await this.sallaOAuthService.exchangeCodeForTokens(
        query.code,
        query.state,
      );

      this.logger.log(`OAuth completed successfully`, {
        tenantId: result.tenantId,
        merchantId: result.merchantId,
      });

      // ✅ إعادة التوجيه للـ frontend مع نجاح
      return res.redirect(
        `${frontendUrl}${redirectPath}?status=success&merchant=${result.merchantId}`,
      );

    } catch (error) {
      this.logger.error(`OAuth callback error`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });

      return res.redirect(
        `${frontendUrl}${redirectPath}?status=error&reason=connection_failed`,
      );
    }
  }
}
