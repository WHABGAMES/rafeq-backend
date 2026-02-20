/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid OAuth Controller                           ║
 * ║                                                                                ║
 * ║  Endpoints:                                                                    ║
 * ║  POST /api/stores/zid/connect  → بدء OAuth مع زد (يرجع { redirectUrl })       ║
 * ║  GET  /api/stores/zid/callback → Callback من زد (browser redirect)            ║
 * ║  POST /api/stores/zid/callback → Callback من زد (server-to-server)            ║
 * ║                                                                                ║
 * ║  🔀 الـ callback يتعامل مع 3 حالات:                                            ║
 * ║     0. بدون params → redirect لصفحة OAuth (install flow من زد)                ║
 * ║     1. من الداشبورد (فيه state + tenantId) → ربط متجر لحساب موجود             ║
 * ║     2. من متجر زد (بدون state) → إنشاء حساب + إرسال بيانات دخول              ║
 * ║                                                                                ║
 * ║  ✅ FIX: زد يحوّل المتصفح مباشرة للـ callback بدون code                         ║
 * ║     لازم نحوّله لصفحة OAuth عشان التاجر يوافق ويرجع بـ code                    ║
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
  Req,
  Res,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response, Request as ExpressRequest } from 'express';
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /stores/zid/connect — بدء OAuth من الداشبورد
  // ═══════════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // GET /stores/zid/callback — Browser redirect من زد
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('callback')
  @Public()
  @ApiOperation({
    summary: 'Callback من زد (GET)',
    description: 'يستقبل authorization code من زد عبر browser redirect',
  })
  async handleCallbackGet(
    @Req() req: ExpressRequest,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logFullRequest(req, 'GET');

    // ═════════════════════════════════════════════════════════
    // ✅ Install Flow — زد يحوّل المتصفح بدون code
    // التاجر ضغط "تفعيل" → نحوّله لصفحة OAuth عشان يوافق
    // ═════════════════════════════════════════════════════════
    if (!code && !state && !error) {
      this.logger.log('🔀 Zid install flow detected → redirecting to OAuth authorize');

      const clientId = this.configService.get<string>('zid.clientId');
      const redirectUri = this.configService.get<string>('zid.oauthCallbackUrl');

      if (!clientId || !redirectUri) {
        this.logger.error('❌ Zid OAuth config missing (clientId or redirectUri)');
        const frontendUrl = this.configService.get<string>('app.frontendUrl') || 'https://rafeq.ai';
        res.redirect(`${frontendUrl}/dashboard/stores?status=error&reason=config_missing`);
        return;
      }

      const oauthParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
      });

      const oauthUrl = `https://oauth.zid.sa/oauth/authorize?${oauthParams.toString()}`;
      this.logger.log(`🔗 Redirecting to: ${oauthUrl}`);
      res.redirect(oauthUrl);
      return;
    }

    return this.processOAuthCallback({ code, state, error, errorDescription }, res);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // POST /stores/zid/callback — Server-to-server من زد
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('callback')
  @Public()
  @ApiOperation({
    summary: 'Callback من زد (POST)',
    description: 'يستقبل authorization code من زد عبر POST',
  })
  async handleCallbackPost(
    @Req() req: ExpressRequest,
    @Res() res: Response,
  ): Promise<void> {
    this.logFullRequest(req, 'POST');

    // استخراج البيانات من body و/أو query
    const query = req.query || {};
    const body = req.body || {};

    const code = (body.code || query.code || body.authorization_code) as string | undefined;
    const state = (body.state || query.state) as string | undefined;
    const error = (body.error || query.error) as string | undefined;
    const errorDescription = (body.error_description || query.error_description) as string | undefined;

    // ═════════════════════════════════════════════════════════
    // ✅ Install Flow — POST بدون بيانات → redirect to OAuth
    // ═════════════════════════════════════════════════════════
    if (!code && !state && !error) {
      this.logger.log('🔀 Zid install flow (POST) → redirecting to OAuth authorize');

      const clientId = this.configService.get<string>('zid.clientId');
      const redirectUri = this.configService.get<string>('zid.oauthCallbackUrl');

      if (!clientId || !redirectUri) {
        this.logger.error('❌ Zid OAuth config missing');
        const frontendUrl = this.configService.get<string>('app.frontendUrl') || 'https://rafeq.ai';
        res.redirect(`${frontendUrl}/dashboard/stores?status=error&reason=config_missing`);
        return;
      }

      const oauthParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
      });

      const oauthUrl = `https://oauth.zid.sa/oauth/authorize?${oauthParams.toString()}`;
      this.logger.log(`🔗 Redirecting to: ${oauthUrl}`);
      res.redirect(oauthUrl);
      return;
    }

    return this.processOAuthCallback({ code, state, error, errorDescription }, res);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 معالجة OAuth Callback الموحدة
  // ═══════════════════════════════════════════════════════════════════════════════

  private async processOAuthCallback(
    params: {
      code?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
    },
    res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('app.frontendUrl')
      || this.configService.get<string>('FRONTEND_URL')
      || 'https://rafeq.ai';
    const redirectPath = '/dashboard/stores';

    try {
      this.logger.log(`Zid OAuth callback processing`, {
        hasCode: !!params.code,
        hasState: !!params.state,
        hasError: !!params.error,
      });

      // ✅ معالجة الأخطاء من زد
      if (params.error) {
        this.logger.warn('OAuth error from Zid', {
          error: params.error,
          errorDescription: params.errorDescription,
        });
        res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=${encodeURIComponent(params.errorDescription || params.error)}`,
        );
        return;
      }

      // ✅ التحقق من وجود code
      if (!params.code) {
        this.logger.warn('Missing code in Zid callback');
        res.redirect(
          `${frontendUrl}${redirectPath}?status=error&reason=missing_code`,
        );
        return;
      }

      // ═══════════════════════════════════════════════════════════════
      // 🔀 تحديد نوع الطلب: من الداشبورد أو من متجر زد
      // ═══════════════════════════════════════════════════════════════
      const hasValidState = params.state && this.zidOAuthService.isValidState(params.state);

      if (hasValidState) {
        // ════════════════════════════════════════════════════════════
        // 🔗 حالة 1: من الداشبورد — ربط متجر لحساب موجود
        // ════════════════════════════════════════════════════════════
        this.logger.log(`📊 Zid Dashboard connect flow`);

        const { tokens, tenantId } = await this.zidOAuthService.exchangeCodeForTokens(
          params.code,
          params.state!,
        );
        const storeInfo = await this.zidOAuthService.getStoreInfo(tokens.access_token);

        const store = await this.storesService.connectZidStore(tenantId, {
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: this.zidOAuthService.calculateTokenExpiry(tokens.expires_in),
            authorization: tokens.authorization,
          },
          storeInfo,
        });

        this.logger.log(`✅ Zid store connected from dashboard: ${storeInfo.name}`, {
          tenantId,
          storeId: store.id,
          zidStoreId: storeInfo.id,
        });

        res.redirect(
          `${frontendUrl}${redirectPath}?status=success&store_id=${store.id}`,
        );

      } else {
        // ════════════════════════════════════════════════════════════
        // 🆕 حالة 2: تثبيت من متجر زد — إنشاء حساب + إرسال بيانات
        // ════════════════════════════════════════════════════════════
        this.logger.log(`🆕 Zid store install flow — creating account`);

        const result = await this.zidOAuthService.exchangeCodeAndAutoRegister(params.code);

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

        res.redirect(
          `${frontendUrl}/auth/login?${redirectParams.toString()}`,
        );
      }

    } catch (error: any) {
      this.logger.error('Zid OAuth callback error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      res.redirect(
        `${frontendUrl}${redirectPath}?status=error&reason=connection_failed`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📝 تسجيل تفاصيل الطلب الكاملة (للتشخيص)
  // ═══════════════════════════════════════════════════════════════════════════════

  private logFullRequest(req: ExpressRequest, method: string): void {
    const bodyKeys = req.body ? Object.keys(req.body) : [];
    const queryKeys = req.query ? Object.keys(req.query) : [];

    this.logger.log(`🔍 Zid callback [${method}] — request details`, {
      url: req.originalUrl,
      queryKeys,
      queryParams: req.query || {},
      bodyKeys,
      body: bodyKeys.length > 0 ? req.body : '(empty)',
      headers: {
        'content-type': req.headers['content-type'] || '(none)',
        'user-agent': req.headers['user-agent'] || '(none)',
        'x-zid-signature': req.headers['x-zid-signature'] || '(none)',
        'referer': req.headers['referer'] || '(none)',
        'origin': req.headers['origin'] || '(none)',
      },
      ip: req.headers['x-forwarded-for'] || req.ip || '(unknown)',
    });
  }
  @Post(':storeId/reregister-webhooks')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async reRegisterWebhooks(
    @Req() req: any,
    @Param('storeId') storeId: string,
  ) {
    this.logger.log(`🔔 Re-registering Zid webhooks for store: ${storeId}`);
    const result = await this.zidOAuthService.reRegisterWebhooks(storeId, req.user.tenantId);
    return { success: true, ...result };
  }

}
