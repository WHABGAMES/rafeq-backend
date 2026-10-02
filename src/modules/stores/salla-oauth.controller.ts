/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ - Salla OAuth Controller                                  ║
 * ║                                                                                ║
 * ║  ✅ POST /connect - مع JwtAuthGuard - يرجع { redirectUrl }                    ║
 * ║  ✅ GET /callback - بدون Guard - يعالج الـ OAuth callback                     ║
 * ║                                                                                ║
 * ║  التطبيق المنشور يستخدم Easy Mode عبر app.store.authorize.                    ║
 * ║  callback أدناه متروك فقط لتوافق Custom Mode الموقّع القديم.                  ║
 * ║                                                                                ║
 * ║  🐛 FIX: extractTenantId كان يفشل دائماً لأن الـ state                         ║
 * ║     بصيغة base64url.hmac_hex وليس base64 عادي                                 ║
 * ║     → كل flows كانت تمر عبر auto-registration بدل dashboard                  ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/salla-oauth.controller.ts                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Post,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';

// Guards
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Services
import { SallaOAuthService } from './salla-oauth.service';

// ✅ DTOs inline
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
   * يعيد رابط تثبيت التطبيق الرسمي في متجر سلة.
   */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  async connect(
    @Req() req: Request,
  ): Promise<{ redirectUrl: string }> {
    const user = req.user as { id: string; tenantId: string };

    this.logger.log(`OAuth connect initiated`, {
      userId: user.id,
      tenantId: user.tenantId,
      flow: 'salla-app-store-install',
    });

    const appId = this.configService.get<string>('salla.appId')?.trim();
    if (!appId || !/^\d+$/.test(appId)) {
      throw new ServiceUnavailableException('ربط سلة غير مهيأ حالياً');
    }
    const redirectUrl = `https://s.salla.sa/apps/install/${appId}`;

    return { redirectUrl };
  }

  /**
   * ✅ GET /stores/salla/callback
   * يعالج الـ callback من سلة
   *
   * Custom Mode legacy callback. Missing or invalid state is rejected;
   * Easy Mode installation is handled only by app.store.authorize.
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
      const stateData = this.tryDecodeState(query.state);

      if (stateData) {
        // ════════════════════════════════════════════════════════════
        // 🔗 حالة 1: من الداشبورد — ربط متجر لحساب موجود
        // ✅ FIX: الآن يستخدم decodeState الصحيح مع HMAC verification
        // ════════════════════════════════════════════════════════════
        this.logger.log(`📊 Dashboard connect flow — tenantId: ${stateData.tenantId}`);

        const result = await this.sallaOAuthService.exchangeCodeForTokens(
          query.code,
          stateData.tenantId,
        );

        this.logger.log(`✅ OAuth completed — merchant ${result.merchantId}`);

        const redirectParams = new URLSearchParams({
          status: 'success',
          merchant: result.merchantId.toString(),
        });

        // تمرير custom state للـ frontend (CSRF check)
        if (stateData.custom) {
          redirectParams.set('state', stateData.custom);
        }

        return res.redirect(
          `${frontendUrl}${redirectPath}?${redirectParams.toString()}`,
        );

      } else {
        // Published Salla apps use Easy Mode and are provisioned exclusively by
        // the signed app.store.authorize webhook. A missing/invalid state on this
        // legacy custom-mode callback must never become an account-registration
        // shortcut.
        this.logger.warn('Rejected Salla callback with missing or invalid state');
        return res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=invalid_state`,
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
  // 🔧 FIX: فك state parameter بشكل صحيح مع HMAC verification
  //
  // 🐛 الكود القديم:
  //    Buffer.from(state, 'base64') → كان يفشل دائماً لأن:
  //    1. الـ state بصيغة base64url (مش base64)
  //    2. الـ state يحتوي على '.' separator + HMAC signature
  //    → JSON.parse يفشل → يرجع null → كل flows تمر عبر auto-registration
  //
  // ✅ الحل: نستخدم decodeState من SallaOAuthService مباشرة
  //    الذي يتحقق من HMAC + timestamp + يفك الـ base64url
  // ═══════════════════════════════════════════════════════════════════════════════

  private tryDecodeState(state?: string): { tenantId: string; custom: string } | null {
    if (!state) return null;

    try {
      // ✅ نستخدم decodeState الذي يتحقق من:
      // 1. صيغة base64url.hmac_hex
      // 2. HMAC signature صحيح (timing-safe)
      // 3. timestamp لم ينتهِ (10 دقائق)
      return this.sallaOAuthService.decodeState(state);
    } catch {
      // state غير صالح أو منتهي = تثبيت من متجر سلة (مش من الداشبورد)
      this.logger.debug('State not valid — treating as Salla store install');
      return null;
    }
  }
}
