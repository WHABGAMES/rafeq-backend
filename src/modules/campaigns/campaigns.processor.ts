/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Queue Processor                        ║
 * ║                                                                                ║
 * ║  يعالج jobs من queue 'campaigns':                                              ║
 * ║    - send-campaign-message: إرسال رسالة حملة لعميل واحد                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import { Campaign, CampaignStatus, Customer, Channel } from '@database/entities';
import { ChannelStatus } from '@modules/channels/entities/channel.entity';
import { WhatsAppService } from '@modules/channels/whatsapp/whatsapp.service';
import { Store } from '@modules/stores/entities/store.entity';

interface SendCampaignMessageJobData {
  campaignId: string;
  customerId: string;
}

@Processor('campaigns')
export class CampaignsProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignsProcessor.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,

    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,

    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    @InjectRepository(Store)
    private readonly storeRepo: Repository<Store>,

    private readonly whatsappService: WhatsAppService,
  ) {
    super();
  }

  async process(job: Job<SendCampaignMessageJobData>): Promise<void> {
    const { campaignId, customerId } = job.data;

    this.logger.log(`Processing campaign message: campaign=${campaignId} customer=${customerId}`);

    try {
      // 1. Load campaign
      const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
      if (!campaign || campaign.status === CampaignStatus.CANCELLED || campaign.status === CampaignStatus.PAUSED) {
        this.logger.warn(`Campaign ${campaignId} not active — skipping`);
        return;
      }

      // 2. Load customer
      const customer = await this.customerRepo.findOne({ where: { id: customerId } });
      if (!customer) {
        this.logger.warn(`Customer ${customerId} not found — skipping`);
        await this.updateStats(campaignId, 'failed');
        return;
      }

      // 3. Get phone number (Customer entity uses 'phone' field)
      const phone = customer.phone;
      if (!phone) {
        this.logger.warn(`Customer ${customerId} has no phone — skipping`);
        await this.updateStats(campaignId, 'failed');
        return;
      }

      // 4. Find a connected WhatsApp channel for this tenant
      //    Channel belongs to Store, Store belongs to Tenant
      //    campaign.storeId → direct lookup
      //    campaign.tenantId → find stores first, then channels
      let channel: Channel | null = null;

      if (campaign.storeId) {
        // Direct: find channel by storeId
        channel = await this.channelRepo.findOne({
          where: {
            storeId: campaign.storeId,
            type: In(['whatsapp_official', 'whatsapp_qr']),
            status: ChannelStatus.CONNECTED,
          },
        });
      }

      if (!channel) {
        // Fallback: find any connected WhatsApp channel for tenant's stores
        const stores = await this.storeRepo.find({
          where: { tenantId: campaign.tenantId },
          select: ['id'],
        });

        if (stores.length > 0) {
          const storeIds = stores.map(s => s.id);
          channel = await this.channelRepo.findOne({
            where: {
              storeId: In(storeIds),
              type: In(['whatsapp_official', 'whatsapp_qr']),
              status: ChannelStatus.CONNECTED,
            },
          });
        }
      }

      if (!channel) {
        this.logger.warn(`No connected WhatsApp channel for tenant ${campaign.tenantId}`);
        await this.updateStats(campaignId, 'failed');
        return;
      }

      // 5. Get WhatsApp credentials from Channel entity (direct fields, NOT credentials object)
      const phoneNumberId = channel.whatsappPhoneNumberId;
      const accessToken = channel.whatsappAccessToken;

      if (!phoneNumberId || !accessToken) {
        this.logger.warn(`Channel ${channel.id} missing WhatsApp credentials`);
        await this.updateStats(campaignId, 'failed');
        return;
      }

      // 6. Build message from campaign template
      const template = campaign.messageTemplate;
      let messageBody = template?.body || '';

      if (!messageBody) {
        this.logger.warn(`Campaign ${campaignId} has empty message template`);
        await this.updateStats(campaignId, 'failed');
        return;
      }

      // Replace variables with customer data
      const customerName = customer.fullName || customer.firstName || 'عميلنا';
      messageBody = messageBody
        .replace(/\{\{name\}\}/g, customerName)
        .replace(/\{\{first_name\}\}/g, customer.firstName || customerName)
        .replace(/\{\{phone\}\}/g, phone);

      // 7. Send via WhatsApp
      await this.whatsappService.sendTextMessage(phoneNumberId, phone, messageBody, accessToken);

      // 8. Update stats
      await this.updateStats(campaignId, 'sent');

      this.logger.log(`Campaign message sent: campaign=${campaignId} → ${phone}`);

      // 9. Check if campaign is complete
      await this.checkCampaignCompletion(campaignId);

    } catch (error: any) {
      this.logger.error(`Campaign message failed: campaign=${campaignId} customer=${customerId} — ${error.message}`);
      await this.updateStats(campaignId, 'failed');
    }
  }

  /**
   * Update campaign stats atomically via JSONB
   */
  private async updateStats(campaignId: string, field: 'sent' | 'delivered' | 'read' | 'failed'): Promise<void> {
    try {
      await this.campaignRepo
        .createQueryBuilder()
        .update(Campaign)
        .set({
          stats: () => `jsonb_set(stats, '{${field}}', (COALESCE((stats->>'${field}')::int, 0) + 1)::text::jsonb)`,
        })
        .where('id = :id', { id: campaignId })
        .execute();
    } catch (err) {
      this.logger.error(`Failed to update stats for campaign ${campaignId}`);
    }
  }

  /**
   * Check if all messages processed → mark campaign completed
   */
  private async checkCampaignCompletion(campaignId: string): Promise<void> {
    try {
      const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
      if (!campaign || campaign.status !== CampaignStatus.ACTIVE) return;

      const stats = campaign.stats;
      const processed = (stats.sent || 0) + (stats.failed || 0);

      if (processed >= stats.totalTargeted && stats.totalTargeted > 0) {
        await this.campaignRepo.update(campaignId, {
          status: CampaignStatus.COMPLETED,
          completedAt: new Date(),
        } as any);
        this.logger.log(`Campaign ${campaignId} completed: ${stats.sent} sent, ${stats.failed} failed`);
      }
    } catch {
      // Non-critical
    }
  }
}
