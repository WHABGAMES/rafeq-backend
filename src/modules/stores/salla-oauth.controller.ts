/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Salla OAuth Controller                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Query,
  Res,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

// Services
import { SallaOAuthService } from './salla-oauth.service';
import { StoresService } from './stores.service';

@Controller('stores/salla')
@ApiTags('Salla OAuth')
export class SallaOAuthController {
  private readonly logger = new Logger(SallaOAuthController.name);

  constructor(
    private readonly sallaOAuthService: SallaOAuthService,
    private readonly storesService: StoresService,
    private readonly configService: ConfigService,
  ) {}

  @Get('connect')
  @ApiOperation({
    summary: 'بدء ربط متجر سلة',
    description: 'يُحول المستخدم لصفحة تسجيل الدخول في سلة',
  })
  async connectStore(
    @Res() res: Response,
  ): Promise<void> {
    const tenantId = 'temp-tenant-id';

    try {
      const authUrl = this.sallaOAuthService.generateAuthorizationUrl(tenantId);
      this.logger.log(`Redirecting tenant ${tenantId} to Salla OAuth`);
      res.redirect(authUrl);
    } catch (error) {
      this.logger.error('Failed to start OAuth flow', error);
      throw new BadRequestException('Failed to start connection process');
    }
  }

  @Get('callback')
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
    const frontendUrl = this.configService.get<string>('app.frontendUrl') || 'http://localhost:3001';

    try {
      if (error) {
        this.logger.warn('OAuth error from Salla', { error, errorDescription });
        res.redirect(`${frontendUrl}/stores/connect?error=${encodeURIComponent(errorDescription || error)}`);
        return;
      }

      if (!code || !state) {
        this.logger.warn('Missing code or state in callback');
        res.redirect(`${frontendUrl}/stores/connect?error=missing_params`);
        return;
      }

      const { tokens, tenantId } = await this.sallaOAuthService.exchangeCodeForTokens(code, state);
      const merchantInfo = await this.sallaOAuthService.getMerchantInfo(tokens.access_token);

      const store = await this.storesService.connectSallaStore(tenantId, {
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: this.sallaOAuthService.calculateTokenExpiry(tokens.expires_in),
        },
        merchantInfo,
      });

      this.logger.log(`Successfully connected Salla store: ${merchantInfo.name}`, {
        tenantId,
        storeId: store.id,
        merchantId: merchantInfo.id,
      });

      res.redirect(`${frontendUrl}/stores/connect/success?store_id=${store.id}`);

    } catch (error) {
      this.logger.error('OAuth callback error', {
        error: error instanceof Error ? error.message : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });

      res.redirect(`${frontendUrl}/stores/connect?error=connection_failed`);
    }
  }
}
