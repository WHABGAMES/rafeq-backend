/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - SMS Controller                                   ║
 * ║                                                                                ║
 * ║  📌 إدارة قناة SMS                                                             ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  POST   /channels/sms/connect      → ربط مزود SMS                             ║
 * ║  GET    /channels/sms/providers    → المزودين المدعومين                       ║
 * ║  GET    /channels/sms/status       → حالة الاتصال                             ║
 * ║  POST   /channels/sms/send         → إرسال رسالة                              ║
 * ║  POST   /channels/sms/bulk         → إرسال جماعي                              ║
 * ║  GET    /channels/sms/balance      → الرصيد المتبقي                           ║
 * ║  DELETE /channels/sms/disconnect   → فصل الاتصال                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  
  ApiBearerAuth,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { SmsService } from './sms.service';

@ApiTags('Channels - SMS')
@Controller({
  path: 'channels/sms',
  version: '1',
})
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Providers
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('providers')
  @ApiOperation({
    summary: 'المزودين المدعومين',
    description: 'قائمة مزودي خدمة SMS المدعومين',
  })
  getProviders() {
    return {
      providers: [
        {
          id: 'unifonic',
          name: 'يونيفونك',
          nameEn: 'Unifonic',
          country: 'SA',
          logo: 'https://unifonic.com/logo.png',
          features: ['otp', 'marketing', 'transactional', 'arabic'],
          pricingUrl: 'https://unifonic.com/pricing',
        },
        {
          id: 'twilio',
          name: 'تويليو',
          nameEn: 'Twilio',
          country: 'Global',
          logo: 'https://twilio.com/logo.png',
          features: ['otp', 'marketing', 'transactional'],
          pricingUrl: 'https://twilio.com/sms/pricing',
        },
        {
          id: 'taqnyat',
          name: 'تقنيات',
          nameEn: 'Taqnyat',
          country: 'SA',
          logo: 'https://taqnyat.sa/logo.png',
          features: ['otp', 'marketing', 'arabic'],
        },
        {
          id: 'gateway',
          name: 'جيتواي',
          nameEn: 'Gateway.sa',
          country: 'SA',
          logo: 'https://gateway.sa/logo.png',
          features: ['otp', 'marketing', 'transactional', 'arabic'],
        },
        {
          id: 'cequens',
          name: 'سيكوينز',
          nameEn: 'CEQUENS',
          country: 'MENA',
          logo: 'https://cequens.com/logo.png',
          features: ['otp', 'marketing', 'transactional', 'arabic'],
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Connection
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'ربط مزود SMS',
    description: 'ربط حساب مزود SMS',
  })
  async connect(
    @Body() body: {
      provider: string;
      apiKey: string;
      apiSecret?: string;
      senderId: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.smsService.connect(tenantId, body);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'حالة الاتصال',
    description: 'التحقق من حالة اتصال SMS',
  })
  async getStatus() {
    const tenantId = 'test-tenant-id';
    return this.smsService.getStatus(tenantId);
  }

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'الرصيد',
    description: 'الرصيد المتبقي من رسائل SMS',
  })
  async getBalance() {
    const tenantId = 'test-tenant-id';
    return this.smsService.getBalance(tenantId);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'فصل SMS',
    description: 'فصل الربط مع مزود SMS',
  })
  async disconnect() {
    const tenantId = 'test-tenant-id';
    await this.smsService.disconnect(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Messaging
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال رسالة',
    description: 'إرسال رسالة SMS',
  })
  async sendMessage(
    @Body() body: {
      to: string;
      message: string;
      senderId?: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.smsService.send(tenantId, body);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال جماعي',
    description: 'إرسال رسائل SMS لعدة أرقام',
  })
  async sendBulk(
    @Body() body: {
      recipients: string[];
      message: string;
      senderId?: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.smsService.sendBulk(tenantId, body);
  }

  @Post('otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال OTP',
    description: 'إرسال رمز تحقق',
  })
  async sendOtp(
    @Body() body: {
      to: string;
      code?: string;
      template?: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.smsService.sendOtp(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Reports
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('reports')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تقارير الإرسال',
    description: 'تقارير الرسائل المرسلة',
  })
  async getReports(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const tenantId = 'test-tenant-id';
    return this.smsService.getReports(tenantId, { from, to, page, limit });
  }
}
