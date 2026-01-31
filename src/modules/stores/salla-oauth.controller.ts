/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Controller                         ║
 * ║                                                                                ║
 * ║  ✅ Updated: Secure redirects with status param (no store_id exposure)         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Query,
  Body,
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
import { SallaOAuthService } from './salla-oauth.service';
import { StoresService } from './stores.service';

// Auth
import { JwtAuthGuard, Public } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

interface RequestWithUser extends Request {
  user: User;
}

@Controller('stores/salla')
@ApiTags('Salla OAuth')
export class SallaOAuthController {
  private readonly logger = new Logger(SallaOAuthController.name);

  constructor(
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly storesService: StoresService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * ✅ POST /stores/salla/connect
   * بدء عملية OAuth - يستقبل CSRF state من Frontend
   */
  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'بدء ربط متجر سلة',
    description: 'يُرجع رابط OAuth للتحويل',
  })
  async connectStore(
    @Request() req: RequestWithUser,
    @Body() body: { state?: string },
  ): Promise<{ redirectUrl: string }> {
    const tenantId = req.user.tenantId;
    const csrfState = body.state;

    try {
      // ✅ Generate auth URL with tenant + CSRF state
      const authUrl = this.sallaOAuthService.generateAuthorizationUrl(tenantId, csrfState);
      
      this.logger.log(`Generated OAuth URL for tenant ${tenantId}`);
      
      return { redirectUrl: authUrl };
    } catch (error: any) {
      this.logger.error('Failed to start OAuth flow', error);
      throw new BadRequestException('Failed to start connection process');
    }
  }

  /**
   * ✅ GET /stores/salla/connect (Legacy support)
   * للتوافق مع الطريقة القديمة
   */
  @Get('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'بدء ربط متجر سلة (Legacy)',
    description: 'يُحول المستخدم لصفحة تسجيل الدخول في سلة',
  })
  async connectStoreLegacy(
    @Request() req: RequestWithUser,
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = req.user.tenantId;

    try {
      const authUrl = this.sallaOAuthService.generateAuthorizationUrl(tenantId);
      this.logger.log(`Redirecting tenant ${tenantId} to Salla OAuth`);
      res.redirect(authUrl);
    } catch (error: any) {
      this.logger.error('Failed to start OAuth flow', error);
      throw new BadRequestException('Failed to start connection process');
    }
  }

  /**
   * ✅ GET /stores/salla/callback
   * Callback من سلة - يعالج النتيجة ويحوّل للـ Frontend
   */
  @Get('callback')
  @Public()
  @ApiOperation({
    summary: 'Callback من سلة',
    description: 'يستقبل authorization code من سلة ويكمل عملية الربط',
  })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ): Promise<void> {
    // ✅ Frontend URL for redirects
    const frontendUrl = this.configService.get<string>('app.frontendUrl') || 'https://rafeq.ai';
    const connectPage = `${frontendUrl}/connect-store.html`;

    try {
      // ═══════════════════════════════════════════════════════════════════════════
      // Handle OAuth Error from Salla
      // ═══════════════════════════════════════════════════════════════════════════
      if (error) {
        this.logger.warn('OAuth error from Salla', { error, errorDescription });
        
        // ✅ Secure redirect: status + reason (no sensitive data)
        const reason = error === 'access_denied' ? 'access_denied' : 'connection_failed';
        res.redirect(`${connectPage}?status=error&reason=${reason}&state=${state || ''}`);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // Validate Required Params
      // ═══════════════════════════════════════════════════════════════════════════
      if (!code || !state) {
        this.logger.warn('Missing code or state in callback');
        res.redirect(`${connectPage}?status=error&reason=invalid_state`);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // Exchange Code for Tokens
      // ═══════════════════════════════════════════════════════════════════════════
      const { tokens, tenantId, csrfState } = await this.sallaOAuthService.exchangeCodeForTokens(code, state);
      
      // ═══════════════════════════════════════════════════════════════════════════
      // Get Merchant Info
      // ═══════════════════════════════════════════════════════════════════════════
      const merchantInfo = await this.sallaOAuthService.getMerchantInfo(tokens.access_token);

      // ═══════════════════════════════════════════════════════════════════════════
      // Create/Update Store
      // ═══════════════════════════════════════════════════════════════════════════
      const store = await this.storesService.connectSallaStore(tenantId, {
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: this.sallaOAuthService.calculateTokenExpiry(tokens.expires_in),
        },
        merchantInfo,
      });

      this.logger.log(`✅ Successfully connected Salla store: ${merchantInfo.name}`, {
        tenantId,
        storeId: store.id,
        merchantId: merchantInfo.id,
      });

      // ═══════════════════════════════════════════════════════════════════════════
      // ✅ Secure Redirect: Only status + CSRF state (NO store_id)
      // ═══════════════════════════════════════════════════════════════════════════
      res.redirect(`${connectPage}?status=success&state=${csrfState || ''}`);

    } catch (error: any) {
      this.logger.error('OAuth callback error', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // ✅ Secure error redirect
      res.redirect(`${connectPage}?status=error&reason=connection_failed&state=${state || ''}`);
    }
  }
}
