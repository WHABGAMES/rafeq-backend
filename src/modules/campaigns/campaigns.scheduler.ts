/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Scheduler                              ║
 * ║                                                                                ║
 * ║  يفحص كل دقيقة: هل فيه حملات مجدولة وصل وقتها؟                              ║
 * ║  إذا نعم → ينفذها عبر CampaignsService.executeNow()                         ║
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

  /**
   * يفحص كل دقيقة: هل فيه حملات مجدولة وصل وقتها؟
   */
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

      this.logger.log(`Found ${dueCampaigns.length} scheduled campaigns due for execution`);

      for (const campaign of dueCampaigns) {
        try {
          await this.campaignsService.executeNow(campaign.id, campaign.tenantId);
          this.logger.log(`Executed scheduled campaign: ${campaign.id} — ${campaign.name}`);
        } catch (err: any) {
          this.logger.error(`Failed to execute campaign ${campaign.id}: ${err.message}`);
          // Mark as failed so we don't retry endlessly
          await this.campaignRepo.update(campaign.id, {
            status: CampaignStatus.FAILED,
            metadata: {
              ...((campaign as any).metadata || {}),
              lastError: err.message,
            },
          } as any);
        }
      }
    } catch (err: any) {
      this.logger.error(`Scheduler error: ${err.message}`);
    }
  }
}
