/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Zid OAuth Controller                           ║
 * ║                                                                                ║
 * ║  Endpoints:                                                                    ║
 * ║  POST /api/stores/zid/connect  → بدء OAuth مع زد (يرجع { redirectUrl })       ║
 * ║  GET  /api/stores/zid/callback → Callback من زد                               ║
 * ║                                                                                ║
 * ║  🔧 FIX: POST بدل GET في connect لمطابقة الـ Frontend                         ║
 * ║  🔧 FIX: يرجع JSON { redirectUrl } بدل redirect مباشر                         ║
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
   * 🔧 FIX: POST /api/stores/zid/connect
   * بدء عملية OAuth مع زد - يرجع { redirectUrl } بدل redirect مباشر
   * لمطابقة الـ Frontend الذي يستخدم POST ويتوقع JSON
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
      
      // ✅ يرجع JSON بدل redirect
      return { redirectUrl };
    } catch (error: any) {
      this.logger.error('Failed to start Zid OAuth flow', error);
      throw new BadRequestException('فشل في بدء عملية الربط مع زد');
    }
  }

  /**
   * GET /api/stores/zid/callback
   * Callback من زد بعد موافقة المستخدم
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
      if (error) {
        this.logger.warn('OAuth error from Zid', { error, errorDescription });
        res.redirect(`${frontendUrl}${redirectPath}?status=error&reason=${encodeURIComponent(errorDescription || error)}`);
        return;
      }

      if (!code || !state) {
        this.logger.warn('Missing code or state in Zid callback');
        res.redirect(`${frontendUrl}${redirectPath}?status=error&reason=missing_params`);
        return;
      }

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

      this.logger.log(`Successfully connected Zid store: ${storeInfo.name}`, {
        tenantId,
        storeId: store.id,
        zidStoreId: storeInfo.id,
      });

      res.redirect(`${frontendUrl}${redirectPath}?status=success&store_id=${store.id}`);

    } catch (error: any) {
      this.logger.error('Zid OAuth callback error', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      res.redirect(`${frontendUrl}${redirectPath}?status=error&reason=connection_failed`);
    }
  }
}
