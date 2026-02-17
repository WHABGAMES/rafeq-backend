/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid OAuth Controller                           ║
 * ║                                                                                ║
 * ║  Endpoints:                                                                    ║
 * ║  POST /api/stores/zid/connect  → بدء OAuth مع زد (يرجع { redirectUrl })       ║
 * ║  GET  /api/stores/zid/callback → Callback من زد                               ║
 * ║                                                                                ║
 * ║  🔀 الـ callback يتعامل مع حالتين:                                             ║
 * ║     1. من الداشبورد (فيه state + tenantId) → ربط متجر لحساب موجود             ║
 * ║     2. من متجر زد (بدون state) → إنشاء حساب + إرسال بيانات دخول              ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/zid-oauth.controller.ts                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Logger,
  BadRequestException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

// Services
import { ZidOAuthService } from './zid-oauth.service';
import { StoresService } from './stores.service';

// Auth
import { JwtAuthGuard, Public } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

interface RequestWithUser extends Request {
  user: User;
}

// DTO
interface ZidConnectDto {
  state?: string;
}

@Controller('stores/zid')
@ApiTags('Zid OAuth')
export class ZidOAuthController {
  private readonly logger = new Logger(ZidOAuthController.name);

  constructor(
    private readonly zidOAuthService: ZidOAuthService,
    private readonly storesService: StoresService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /stores/zid/connect
   * بدء عملية OAuth مع زد — من الداشبورد
   */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'بدء ربط متجر زد',
    description: 'يُرجع رابط OAuth لزد - الـ Frontend يتولى التحويل',
  })
  async connectStore(
    @Request() req: RequestWithUser,
    @Body() _dto: ZidConnectDto,
  ): Promise<{ redirectUrl: string }> {
    const tenantId = req.user.tenantId;

    try {
      const redirectUrl = this.zidOAuthService.generateAuthorizationUrl(tenantId);
      
      this.logger.log(`Generated Zid OAuth URL for tenant ${tenantId}`);
      
      return { redirectUrl };
    } catch (error: any) {
      this.logger.error('Failed to start Zid OAuth flow', error);
      throw new BadRequestException('فشل في بدء عملية الربط مع زد');
    }
  }

  /**
   * GET /stores/zid/callback
   * Callback من زد بعد موافقة المستخدم
   *
   * 🔀 حالتين:
   *   1. فيه state صالح (من الداشبورد) → ربط متجر لحساب موجود
   *   2. بدون state أو state غير صالح (من متجر زد) → إنشاء حساب + إرسال بيانات
   */
  @Get('callback')
  @Public()
  @ApiOperation({
    summary: 'Callback من زد',
    description: 'يستقبل authorization code من زد ويكمل عملية الربط',
  })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('app.frontendUrl')
      || this.configService.get<string>('FRONTEND_URL')
      || 'https://rafeq.ai';
    const redirectPath = '/dashboard/stores';

    try {
      this.logger.log(`Zid OAuth callback received`, {
        hasCode: !!code,
        hasState: !!state,
        hasError: !!error,
      });

      // ✅ معالجة الأخطاء من زد
      if (error) {
        this.logger.warn('OAuth error from Zid', { error, errorDescription });
        res.redirect(`${frontendUrl}${redirectPath}?status=error&reason=${encodeURIComponent(errorDescription || error)}`);
        return;
      }

      // ✅ التحقق من وجود code
      if (!code) {
        this.logger.warn('Missing code in Zid callback');
        res.redirect(`${frontendUrl}${redirectPath}?status=error&reason=missing_code`);
        return;
      }

      // ═══════════════════════════════════════════════════════════════
      // 🔀 تحديد نوع الطلب: من الداشبورد أو من متجر زد
      // ═══════════════════════════════════════════════════════════════
      const hasValidState = state && this.zidOAuthService.isValidState(state);

      if (hasValidState) {
        // ════════════════════════════════════════════════════════════
        // 🔗 حالة 1: من الداشبورد — ربط متجر لحساب موجود
        // ════════════════════════════════════════════════════════════
        this.logger.log(`📊 Zid Dashboard connect flow`);

        const { tokens, tenantId } = await this.zidOAuthService.exchangeCodeForTokens(code, state);
        const storeInfo = await this.zidOAuthService.getStoreInfo(tokens.access_token);

        const store = await this.storesService.connectZidStore(tenantId, {
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: this.zidOAuthService.calculateTokenExpiry(tokens.expires_in),
          },
          storeInfo,
        });

        this.logger.log(`✅ Zid store connected from dashboard: ${storeInfo.name}`, {
          tenantId,
          storeId: store.id,
          zidStoreId: storeInfo.id,
        });

        res.redirect(`${frontendUrl}${redirectPath}?status=success&store_id=${store.id}`);

      } else {
        // ════════════════════════════════════════════════════════════
        // 🆕 حالة 2: تثبيت من متجر زد — إنشاء حساب + إرسال بيانات
        // ════════════════════════════════════════════════════════════
        this.logger.log(`🆕 Zid store install flow — creating account`);

        const result = await this.zidOAuthService.exchangeCodeAndAutoRegister(code);

        this.logger.log(`✅ Zid Auto-registration completed`, {
          zidStoreId: result.zidStoreId,
          isNewUser: result.isNewUser,
          email: result.email,
        });

        // ✅ توجيه التاجر لصفحة تسجيل الدخول
        const redirectParams = new URLSearchParams({
          status: 'success',
          source: 'zid_install',
          store: result.zidStoreId,
        });

        res.redirect(`${frontendUrl}/auth/login?${redirectParams.toString()}`);
      }

    } catch (error: any) {
      this.logger.error('Zid OAuth callback error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      res.redirect(`${frontendUrl}${redirectPath}?status=error&reason=connection_failed`);
    }
  }
}
