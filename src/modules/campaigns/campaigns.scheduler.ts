/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Scheduler v2                           ║
 * ║                                                                                ║
 * ║  يفحص كل دقيقة: حملات مجدولة وصل وقتها → ينفذها                           ║
 * ║  ✅ FIX: يمرر tenantId صحيح لـ executeNow                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';

import { Campaign, CampaignStatus } from '@database/entities';
import { CampaignsService } from './campaigns.service';

@Injectable()
export class CampaignsScheduler {
  private readonly logger = new Logger(CampaignsScheduler.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    private readonly campaignsService: CampaignsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkScheduledCampaigns(): Promise<void> {
    try {
      const now = new Date();

      const dueCampaigns = await this.campaignRepo.find({
        where: {
          status: CampaignStatus.SCHEDULED,
          scheduledAt: LessThanOrEqual(now),
        },
      });

      if (dueCampaigns.length === 0) return;

      this.logger.log(`📣 Found ${dueCampaigns.length} scheduled campaigns due for execution`);

      for (const campaign of dueCampaigns) {
        try {
          await this.campaignsService.executeNow(campaign.id, campaign.tenantId);
          this.logger.log(`📣 Executed: ${campaign.id} "${campaign.name}"`);
        } catch (err: any) {
          this.logger.error(`📣 Failed to execute campaign ${campaign.id}: ${err.message}`);
          await this.campaignRepo.update(campaign.id, {
            status: CampaignStatus.FAILED,
            metadata: {
              ...((campaign as any).metadata || {}),
              lastError: err.message,
              changelog: [
                ...((campaign.metadata as any)?.changelog || []),
                { action: 'scheduler_execution_failed', timestamp: new Date().toISOString() },
              ],
            },
          } as any);
        }
      }
    } catch (err: any) {
      this.logger.error(`📣 Scheduler error: ${err.message}`);
    }
  }
}
