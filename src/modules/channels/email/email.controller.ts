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
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  
  ApiBearerAuth,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
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
    @CurrentUser() user: any,
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
    const tenantId = user.tenantId;
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
  async testConnection(@CurrentUser() user: any,
    @Body() body: { email: string }) {
    const tenantId = user.tenantId;
    return this.emailService.testConnection(tenantId, body.email);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'حالة الاتصال',
    description: 'التحقق من حالة اتصال البريد',
  })
  async getStatus(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
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
  async disconnect(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
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
    @CurrentUser() user: any,
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
    const tenantId = user.tenantId;
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
    @CurrentUser() user: any,
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
    const tenantId = user.tenantId;
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
  async getTemplates(@CurrentUser() user: any) {
    const tenantId = user.tenantId;
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
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    const tenantId = user.tenantId;
    return this.emailService.getReports(tenantId, { from, to, page, limit });
  }
}
