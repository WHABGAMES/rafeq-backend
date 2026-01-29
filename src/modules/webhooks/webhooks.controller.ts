/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - General Webhooks Controller                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';

// Services
import { WebhooksService } from './webhooks.service';

// Auth
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '@database/entities';

interface RequestWithUser extends Request {
  user: User;
}

@Controller('webhooks')
@ApiTags('Webhooks Management')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('statistics')
  @ApiOperation({ summary: 'إحصائيات الـ Webhooks' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'عدد الأيام' })
  async getStatistics(
    @Request() req: RequestWithUser,
    @Query('days') days?: number,
  ) {
    return this.webhooksService.getStatistics(req.user.tenantId, days || 7);
  }

  @Get()
  @ApiOperation({ summary: 'قائمة الـ Webhooks' })
  @ApiQuery({ name: 'status', required: false, description: 'فلترة حسب الحالة' })
  @ApiQuery({ name: 'eventType', required: false, description: 'فلترة حسب نوع الحدث' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listWebhooks(
    @Request() req: RequestWithUser,
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.webhooksService.listWebhooks(req.user.tenantId, {
      status,
      eventType,
      page: page || 1,
      limit: limit || 20,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'تفاصيل Webhook' })
  @ApiResponse({ status: 200, description: 'تفاصيل الـ webhook' })
  @ApiResponse({ status: 404, description: 'غير موجود' })
  async getWebhook(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.getWebhookDetails(req.user.tenantId, id);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'سجل معالجة الـ Webhook' })
  async getWebhookLogs(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.getWebhookLogs(req.user.tenantId, id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'إعادة معالجة Webhook فاشل' })
  @ApiResponse({ status: 200, description: 'تم إضافة للـ queue' })
  @ApiResponse({ status: 404, description: 'غير موجود' })
  async retryWebhook(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.retryWebhook(req.user.tenantId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'إلغاء معالجة Webhook' })
  async cancelWebhook(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.cancelWebhook(req.user.tenantId, id);
  }

  @Get('failed/list')
  @ApiOperation({ summary: 'قائمة الـ Webhooks الفاشلة' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getFailedWebhooks(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: number,
  ) {
    return this.webhooksService.getFailedWebhooks(req.user.tenantId, limit || 50);
  }
}
