/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Email Controller                                 ║
 * ║                                                                                ║
 * ║  📌 إدارة قناة البريد الإلكتروني                                               ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  POST   /channels/email/connect      → ربط البريد (SMTP/API)                  ║
 * ║  GET    /channels/email/providers    → المزودين المدعومين                     ║
 * ║  GET    /channels/email/status       → حالة الاتصال                           ║
 * ║  POST   /channels/email/send         → إرسال بريد                             ║
 * ║  POST   /channels/email/test         → اختبار الإعدادات                       ║
 * ║  GET    /channels/email/templates    → قوالب البريد                           ║
 * ║  DELETE /channels/email/disconnect   → فصل الاتصال                            ║
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
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { EmailService } from './email.service';

@ApiTags('Channels - Email')
@Controller({
  path: 'channels/email',
  version: '1',
})
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // Providers
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('providers')
  @ApiOperation({
    summary: 'المزودين المدعومين',
    description: 'قائمة مزودي خدمة البريد الإلكتروني',
  })
  getProviders() {
    return {
      providers: [
        {
          id: 'smtp',
          name: 'SMTP',
          nameEn: 'Custom SMTP',
          description: 'خادم SMTP مخصص',
          type: 'smtp',
          requiredFields: ['host', 'port', 'username', 'password'],
        },
        {
          id: 'sendgrid',
          name: 'سيند جريد',
          nameEn: 'SendGrid',
          description: 'منصة SendGrid للبريد',
          type: 'api',
          requiredFields: ['apiKey'],
        },
        {
          id: 'mailgun',
          name: 'ميل جن',
          nameEn: 'Mailgun',
          description: 'منصة Mailgun للبريد',
          type: 'api',
          requiredFields: ['apiKey', 'domain'],
        },
        {
          id: 'ses',
          name: 'أمازون SES',
          nameEn: 'Amazon SES',
          description: 'خدمة البريد من أمازون',
          type: 'api',
          requiredFields: ['accessKeyId', 'secretAccessKey', 'region'],
        },
        {
          id: 'postmark',
          name: 'بوست مارك',
          nameEn: 'Postmark',
          description: 'منصة Postmark للبريد',
          type: 'api',
          requiredFields: ['serverToken'],
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
    summary: 'ربط البريد',
    description: 'ربط خدمة البريد الإلكتروني',
  })
  async connect(
    @Body() body: {
      provider: string;
      // SMTP
      host?: string;
      port?: number;
      secure?: boolean;
      username?: string;
      password?: string;
      // API
      apiKey?: string;
      domain?: string;
      // Common
      fromEmail: string;
      fromName: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.emailService.connect(tenantId, body);
  }

  @Post('test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'اختبار الإعدادات',
    description: 'إرسال بريد اختباري للتحقق من الإعدادات',
  })
  async testConnection(@Body() body: { email: string }) {
    const tenantId = 'test-tenant-id';
    return this.emailService.testConnection(tenantId, body.email);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'حالة الاتصال',
    description: 'التحقق من حالة اتصال البريد',
  })
  async getStatus() {
    const tenantId = 'test-tenant-id';
    return this.emailService.getStatus(tenantId);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'فصل البريد',
    description: 'فصل الربط مع خدمة البريد',
  })
  async disconnect() {
    const tenantId = 'test-tenant-id';
    await this.emailService.disconnect(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Sending
  // ═══════════════════════════════════════════════════════════════════════════════

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال بريد',
    description: 'إرسال بريد إلكتروني',
  })
  async sendEmail(
    @Body() body: {
      to: string | string[];
      subject: string;
      html?: string;
      text?: string;
      templateId?: string;
      variables?: Record<string, string>;
      attachments?: Array<{
        filename: string;
        content: string;
        encoding?: string;
      }>;
      cc?: string[];
      bcc?: string[];
      replyTo?: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.emailService.send(tenantId, body);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'إرسال جماعي',
    description: 'إرسال بريد لعدة مستلمين',
  })
  async sendBulk(
    @Body() body: {
      recipients: Array<{
        email: string;
        name?: string;
        variables?: Record<string, string>;
      }>;
      subject: string;
      html?: string;
      text?: string;
      templateId?: string;
    },
  ) {
    const tenantId = 'test-tenant-id';
    return this.emailService.sendBulk(tenantId, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Templates
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('templates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'قوالب البريد',
    description: 'قوالب البريد الجاهزة',
  })
  async getTemplates() {
    const tenantId = 'test-tenant-id';
    return this.emailService.getTemplates(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Reports
  // ═══════════════════════════════════════════════════════════════════════════════

  @Get('reports')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'تقارير الإرسال',
    description: 'تقارير البريد المرسل',
  })
  async getReports(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const tenantId = 'test-tenant-id';
    return this.emailService.getReports(tenantId, { from, to, page, limit });
  }
}
