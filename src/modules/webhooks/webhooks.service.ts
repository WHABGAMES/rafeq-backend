/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - General Webhooks Service                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// Entities
import { WebhookEvent, WebhookStatus } from './entities/webhook-event.entity';
import { WebhookLog, WebhookLogAction } from './entities/webhook-log.entity';

// Services
import { SallaWebhooksService } from './salla-webhooks.service';

interface ListWebhooksOptions {
  status?: string;
  eventType?: string;
  page: number;
  limit: number;
}

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepository: Repository<WebhookEvent>,

    @InjectRepository(WebhookLog)
    private readonly webhookLogRepository: Repository<WebhookLog>,

    private readonly sallaWebhooksService: SallaWebhooksService,
  ) {}

  async getStatistics(tenantId: string, days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const totalQuery = this.webhookEventRepository
      .createQueryBuilder('event')
      .where('event.tenantId = :tenantId', { tenantId })
      .andWhere('event.createdAt >= :startDate', { startDate });

    const total = await totalQuery.getCount();

    const byStatus = await this.webhookEventRepository
      .createQueryBuilder('event')
      .select('event.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('event.tenantId = :tenantId', { tenantId })
      .andWhere('event.createdAt >= :startDate', { startDate })
      .groupBy('event.status')
      .getRawMany();

    const byEventType = await this.webhookEventRepository
      .createQueryBuilder('event')
      .select('event.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('event.tenantId = :tenantId', { tenantId })
      .andWhere('event.createdAt >= :startDate', { startDate })
      .groupBy('event.eventType')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    const avgProcessingTime = await this.webhookEventRepository
      .createQueryBuilder('event')
      .select('AVG(event.processingDurationMs)', 'avg')
      .where('event.tenantId = :tenantId', { tenantId })
      .andWhere('event.createdAt >= :startDate', { startDate })
      .andWhere('event.processingDurationMs IS NOT NULL')
      .getRawOne();

    const processedCount = byStatus.find(s => s.status === 'processed')?.count || 0;
    const successRate = total > 0 ? (processedCount / total) * 100 : 0;

    return {
      period: `${days} days`,
      total,
      byStatus: byStatus.reduce((acc, s) => {
        acc[s.status] = parseInt(s.count);
        return acc;
      }, {} as Record<string, number>),
      byEventType: byEventType.map(e => ({
        eventType: e.eventType,
        count: parseInt(e.count),
      })),
      averageProcessingTimeMs: Math.round(avgProcessingTime?.avg || 0),
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  async listWebhooks(tenantId: string, options: ListWebhooksOptions) {
    const { status, eventType, page, limit } = options;

    const query = this.webhookEventRepository
      .createQueryBuilder('event')
      .where('event.tenantId = :tenantId', { tenantId })
      .orderBy('event.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      query.andWhere('event.status = :status', { status });
    }

    if (eventType) {
      query.andWhere('event.eventType = :eventType', { eventType });
    }

    const [items, total] = await query.getManyAndCount();

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getWebhookDetails(tenantId: string, webhookId: string) {
    const webhook = await this.webhookEventRepository.findOne({
      where: { id: webhookId, tenantId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    return webhook;
  }

  async getWebhookLogs(tenantId: string, webhookId: string) {
    const webhook = await this.webhookEventRepository.findOne({
      where: { id: webhookId, tenantId },
      select: ['id'],
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    const logs = await this.webhookLogRepository.find({
      where: { webhookEventId: webhookId },
      order: { createdAt: 'ASC' },
    });

    return logs;
  }

  async retryWebhook(tenantId: string, webhookId: string) {
    const webhook = await this.webhookEventRepository.findOne({
      where: { id: webhookId, tenantId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    if ((webhook.status as WebhookStatus) !== WebhookStatus.FAILED) {
      return {
        success: false,
        message: 'Only failed webhooks can be retried',
        currentStatus: webhook.status,
      };
    }

    const jobId = await this.sallaWebhooksService.retryWebhook(webhookId, tenantId);

    return {
      success: true,
      message: 'Webhook queued for retry',
      jobId,
    };
  }

  async cancelWebhook(tenantId: string, webhookId: string) {
    const webhook = await this.webhookEventRepository.findOne({
      where: { id: webhookId, tenantId },
    });

    if (!webhook) {
      throw new NotFoundException('Webhook not found');
    }

    const currentStatus = webhook.status as WebhookStatus;
    if ([WebhookStatus.PROCESSED, WebhookStatus.SKIPPED].includes(currentStatus)) {
      return {
        success: false,
        message: 'Cannot cancel completed webhooks',
        currentStatus,
      };
    }

    await this.webhookEventRepository.update(webhookId, {
      status: WebhookStatus.SKIPPED,
    });

    await this.sallaWebhooksService.createLog(webhookId, tenantId, {
      action: WebhookLogAction.MANUALLY_CANCELLED,
      previousStatus: currentStatus,
      newStatus: WebhookStatus.SKIPPED,
      message: 'Manually cancelled by user',
      triggeredBy: 'user',
    });

    return {
      success: true,
      message: 'Webhook cancelled',
    };
  }

  async getFailedWebhooks(tenantId: string, limit: number = 50) {
    return this.sallaWebhooksService.getFailedWebhooks(tenantId, limit);
  }
}
