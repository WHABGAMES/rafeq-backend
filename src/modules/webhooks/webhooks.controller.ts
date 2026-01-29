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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

// Services
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
@ApiTags('Webhooks Management')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('statistics')
  @ApiOperation({ summary: 'إحصائيات الـ Webhooks' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'عدد الأيام' })
  async getStatistics(
    @Query('days') days?: number,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.getStatistics(tenantId, days || 7);
  }

  @Get()
  @ApiOperation({ summary: 'قائمة الـ Webhooks' })
  @ApiQuery({ name: 'status', required: false, description: 'فلترة حسب الحالة' })
  @ApiQuery({ name: 'eventType', required: false, description: 'فلترة حسب نوع الحدث' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listWebhooks(
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.listWebhooks(tenantId, {
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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.getWebhookDetails(tenantId, id);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'سجل معالجة الـ Webhook' })
  async getWebhookLogs(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.getWebhookLogs(tenantId, id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'إعادة معالجة Webhook فاشل' })
  @ApiResponse({ status: 200, description: 'تم إضافة للـ queue' })
  @ApiResponse({ status: 404, description: 'غير موجود' })
  async retryWebhook(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.retryWebhook(tenantId, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'إلغاء معالجة Webhook' })
  async cancelWebhook(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.cancelWebhook(tenantId, id);
  }

  @Get('failed/list')
  @ApiOperation({ summary: 'قائمة الـ Webhooks الفاشلة' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getFailedWebhooks(
    @Query('limit') limit?: number,
  ) {
    const tenantId = 'temp-tenant-id';
    return this.webhooksService.getFailedWebhooks(tenantId, limit || 50);
  }
}
