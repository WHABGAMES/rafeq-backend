/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ - Salla OAuth Controller                                  ║
 * ║                                                                                ║
 * ║  ✅ POST /connect - مع JwtAuthGuard - يرجع { redirectUrl }                    ║
 * ║  ✅ GET /callback - بدون Guard - يعالج الـ OAuth callback                     ║
 * ║                                                                                ║
 * ║  🔀 الـ callback يتعامل مع حالتين:                                             ║
 * ║     1. من الداشبورد (فيه state + tenantId) → ربط متجر لحساب موجود             ║
 * ║     2. من متجر سلة (بدون state) → إنشاء حساب + إرسال بيانات دخول             ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/salla-oauth.controller.ts                              ║
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
   * يبدأ عملية OAuth مع سلة — من الداشبورد
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

    const redirectUrl = this.sallaOAuthService.generateAuthorizationUrl(
      user.tenantId,
      dto.state,
    );

    return { redirectUrl };
  }

  /**
   * ✅ GET /stores/salla/callback
   * يعالج الـ callback من سلة
   *
   * 🔀 حالتين:
   *   1. فيه state صالح (من الداشبورد) → ربط متجر لحساب موجود
   *   2. بدون state أو state غير صالح (من متجر سلة) → إنشاء حساب + إرسال بيانات
   */
  @Get('callback')
  async callback(
    @Query() query: SallaCallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')
      || this.configService.get<string>('app.frontendUrl')
      || 'https://rafeq.ai';
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

      // ═══════════════════════════════════════════════════════════════
      // 🔀 تحديد نوع الطلب: من الداشبورد أو من متجر سلة
      // ═══════════════════════════════════════════════════════════════
      const tenantId = this.extractTenantId(query.state);

      if (tenantId) {
        // ════════════════════════════════════════════════════════════
        // 🔗 حالة 1: من الداشبورد — ربط متجر لحساب موجود
        // ════════════════════════════════════════════════════════════
        this.logger.log(`📊 Dashboard connect flow — tenantId: ${tenantId}`);

        const result = await this.sallaOAuthService.exchangeCodeForTokens(
          query.code,
          tenantId,
        );

        this.logger.log(`✅ OAuth completed — merchant ${result.merchantId}`);

        const redirectParams = new URLSearchParams({
          status: 'success',
          merchant: result.merchantId.toString(),
        });

        // تمرير custom state للـ frontend (CSRF check)
        const stateData = this.sallaOAuthService.decodeState(query.state!);
        if (stateData.custom) {
          redirectParams.set('state', stateData.custom);
        }

        return res.redirect(
          `${frontendUrl}${redirectPath}?${redirectParams.toString()}`,
        );

      } else {
        // ════════════════════════════════════════════════════════════
        // 🆕 حالة 2: تثبيت من متجر سلة — إنشاء حساب + إرسال بيانات
        // ════════════════════════════════════════════════════════════
        this.logger.log(`🆕 Salla store install flow — creating account`);

        const result = await this.sallaOAuthService.exchangeCodeAndAutoRegister(
          query.code,
        );

        this.logger.log(`✅ Auto-registration completed`, {
          merchantId: result.merchantId,
          isNewUser: result.isNewUser,
          email: result.email,
        });

        // ✅ توجيه التاجر لصفحة تسجيل الدخول مع رسالة نجاح
        const redirectParams = new URLSearchParams({
          status: 'success',
          source: 'salla_install',
          merchant: result.merchantId.toString(),
        });

        return res.redirect(
          `${frontendUrl}/auth/login?${redirectParams.toString()}`,
        );
      }

    } catch (error) {
      this.logger.error(`OAuth callback error`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });

      return res.redirect(
        `${frontendUrl}${redirectPath}?status=error&reason=connection_failed`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 Helper: استخراج tenantId من state — بدون throw
  // ═══════════════════════════════════════════════════════════════════════════════

  private extractTenantId(state?: string): string | null {
    if (!state) return null;

    try {
      const decoded = Buffer.from(state, 'base64').toString('utf-8');
      const data = JSON.parse(decoded);
      return data.tenantId || null;
    } catch {
      // state غير صالح = تثبيت من متجر سلة (مش من الداشبورد)
      this.logger.debug('State not valid — treating as Salla store install');
      return null;
    }
  }
}
