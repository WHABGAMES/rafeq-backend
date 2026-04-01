import { Controller, Get, Post, Put, Delete, Body, Param, Req, Query, UseGuards, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OtpRelayService } from './otp-relay.service';

@Controller('api/otp-relay')
@UseGuards(JwtAuthGuard)
export class OtpRelayController {
  constructor(private readonly svc: OtpRelayService) {}

  @Get('platforms') getPlatforms() { return this.svc.getPlatforms(); }

  @Get('configs') getConfigs(@Req() r: any) { return this.svc.getConfigs(r.user.tenantId, r.user.storeId); }
  @Get('configs/:id') getConfig(@Param('id') id: string, @Req() r: any) { return this.svc.getConfig(id, r.user.tenantId); }
  @Post('configs') create(@Body() b: any, @Req() r: any) { return this.svc.createConfig(r.user.tenantId, r.user.storeId, b); }
  @Put('configs/:id') update(@Param('id') id: string, @Body() b: any, @Req() r: any) { return this.svc.updateConfig(id, r.user.tenantId, b); }
  @Delete('configs/:id') delete(@Param('id') id: string, @Req() r: any) { return this.svc.deleteConfig(id, r.user.tenantId); }
  @Post('configs/:id/test') test(@Param('id') id: string, @Req() r: any) { return this.svc.testConnection(id, r.user.tenantId); }
  @Get('configs/:id/analytics') analytics(@Param('id') id: string, @Query('days') days: string, @Req() r: any) { return this.svc.getAnalytics(id, r.user.tenantId, Number(days) || 7); }
}

@Controller('api/otp')
export class OtpPublicController {
  constructor(private readonly svc: OtpRelayService) {}

  @Get(':slug') getPage(@Param('slug') slug: string) { return this.svc.getPublicPage(slug); }

  @Post(':slug/verify') @HttpCode(200)
  verify(@Param('slug') slug: string, @Body() b: { orderNumber: string; username: string }, @Req() r: any) {
    const ip = r.headers['x-forwarded-for']?.split(',')[0] || r.ip || 'unknown';
    return this.svc.requestOtp(slug, b.orderNumber, b.username, ip);
  }
}
