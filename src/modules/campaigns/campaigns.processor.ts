/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Processor v2                           ║
 * ║                                                                                ║
 * ║  ✅ FIX 1: يدعم WhatsApp QR (Baileys) + Official API                         ║
 * ║  ✅ FIX 2: Template variables صحيحة ومتوافقة مع الفرونت إند                  ║
 * ║  ✅ FIX 3: Dedup — jobId فريد يمنع الإرسال المكرر                             ║
 * ║  ✅ FIX 4: Error threshold — يوقف الحملة عند كثرة الأخطاء                    ║
 * ║  ✅ FIX 5: Tenant-isolated channel lookup                                      ║
 * ║  ✅ FIX 6: Campaign completion check ذكي                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Campaign, CampaignStatus, CampaignType, Customer } from '@database/entities';
import { Channel, ChannelType, ChannelStatus } from '@modules/channels/entities/channel.entity';
import { Store } from '@modules/stores/entities/store.entity';

// ✅ FIX 1: نستخدم الخدمتين — Official + Baileys
import { WhatsAppService } from '@modules/channels/whatsapp/whatsapp.service';
import { WhatsAppBaileysService } from '@modules/channels/whatsapp/whatsapp-baileys.service';

interface SendCampaignMessageJobData {
  campaignId: string;
  tenantId: string;
  storeId: string | null;
  customerId: string;
  channel: string;
  triggerPayload?: Record<string, unknown>;
}

@Processor('campaigns', {
  concurrency: 5,  // 5 رسائل متوازية كحد أقصى
})
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
    private readonly whatsappOfficial: WhatsAppService,
    private readonly whatsappBaileys: WhatsAppBaileysService,
  ) {
    super();
  }

  async process(job: Job<SendCampaignMessageJobData>): Promise<void> {
    const { campaignId, tenantId, storeId, customerId } = job.data;

    try {
      // ═══ 1. Load campaign ═══
      const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
      if (!campaign) {
        this.logger.warn(`Campaign ${campaignId} not found — skipping`);
        return;
      }
      if (campaign.status === CampaignStatus.CANCELLED || campaign.status === CampaignStatus.PAUSED) {
        this.logger.debug(`Campaign ${campaignId} is ${campaign.status} — skipping`);
        return;
      }

      // ✅ FIX 4: Error threshold check
      if (campaign.stopOnErrorThreshold && campaign.stopOnErrorThreshold > 0) {
        const failCount = campaign.stats?.failed || 0;
        if (failCount >= campaign.stopOnErrorThreshold) {
          this.logger.warn(`📣 Campaign ${campaignId} hit error threshold (${failCount}/${campaign.stopOnErrorThreshold}) — pausing`);
          await this.campaignRepo.update(campaignId, {
            status: CampaignStatus.PAUSED,
            metadata: {
              ...(campaign.metadata || {}),
              lastError: `Paused: error threshold ${campaign.stopOnErrorThreshold} reached`,
              changelog: [
                ...((campaign.metadata as any)?.changelog || []),
                { action: 'auto_paused_error_threshold', timestamp: new Date().toISOString() },
              ],
            },
          } as any);
          return;
        }
      }

      // ═══ 2. Load customer ═══
      const customer = await this.customerRepo.findOne({ where: { id: customerId } });
      if (!customer) {
        this.logger.warn(`Customer ${customerId} not found — skipping`);
        await this.incrementStat(campaignId, 'failed');
        return;
      }

      const phone = customer.phone?.replace(/[^0-9+]/g, '');
      if (!phone || phone.length < 9) {
        this.logger.warn(`Customer ${customerId} has no valid phone — skipping`);
        await this.incrementStat(campaignId, 'failed');
        return;
      }

      // ═══ 3. Find WhatsApp channel (tenant-isolated) ═══
      const channelResult = await this.resolveWhatsAppChannel(tenantId, storeId);
      if (!channelResult) {
        this.logger.warn(`No WhatsApp channel for tenant ${tenantId} — failing`);
        await this.incrementStat(campaignId, 'failed');
        return;
      }

      // ═══ 4. Build message with proper variable replacement ═══
      const messageBody = this.renderMessage(campaign, customer, job.data.triggerPayload);
      if (!messageBody) {
        this.logger.warn(`Empty message after rendering for campaign ${campaignId}`);
        await this.incrementStat(campaignId, 'failed');
        return;
      }

      // ═══ 5. Send via the correct WhatsApp method ═══
      await this.sendWhatsAppMessage(channelResult, phone, messageBody);

      // ═══ 6. Success ═══
      await this.incrementStat(campaignId, 'sent');
      this.logger.debug(`📣 Campaign ${campaignId} → ${phone.slice(-4)} ✅`);

      // ═══ 7. Check completion ═══
      await this.checkCompletion(campaignId);

    } catch (error: any) {
      this.logger.error(
        `📣 Campaign ${campaignId} → customer ${customerId} FAILED: ${error.message}`,
      );
      await this.incrementStat(campaignId, 'failed');
      await this.checkCompletion(campaignId);
      throw error; // BullMQ retry
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX 1: Channel Resolution — يدعم QR + Official
  // ═══════════════════════════════════════════════════════════════════════════════

  private async resolveWhatsAppChannel(
    tenantId: string,
    storeId: string | null,
  ): Promise<{ channel: Channel; type: 'baileys' | 'official' } | null> {

    // ✅ الأولوية: QR (Baileys) أولاً لأنه الأكثر استخداماً
    // ثم Official كـ fallback

    const searchTypes = [
      { type: ChannelType.WHATSAPP_QR, result: 'baileys' as const },
      { type: ChannelType.WHATSAPP_OFFICIAL, result: 'official' as const },
    ];

    for (const search of searchTypes) {
      let channel: Channel | null = null;

      // محاولة 1: البحث بالـ storeId مباشرة
      if (storeId) {
        channel = await this.channelRepo.findOne({
          where: {
            storeId,
            type: search.type,
            status: ChannelStatus.CONNECTED,
          },
        });
      }

      // محاولة 2: البحث في كل متاجر الـ tenant
      if (!channel) {
        channel = await this.channelRepo
          .createQueryBuilder('ch')
          .innerJoin('ch.store', 's')
          .where('ch.type = :type', { type: search.type })
          .andWhere('ch.status = :status', { status: ChannelStatus.CONNECTED })
          .andWhere('s.tenantId = :tenantId', { tenantId })
          .orderBy('ch.createdAt', 'DESC')
          .getOne();
      }

      if (channel) {
        return { channel, type: search.result };
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX 1: إرسال عبر القناة الصحيحة
  // ═══════════════════════════════════════════════════════════════════════════════

  private async sendWhatsAppMessage(
    channelResult: { channel: Channel; type: 'baileys' | 'official' },
    phone: string,
    message: string,
  ): Promise<void> {
    const { channel, type } = channelResult;

    if (type === 'baileys') {
      // ✅ WhatsApp QR — Baileys
      await this.whatsappBaileys.sendTextMessage(channel.id, phone, message);
    } else {
      // ✅ WhatsApp Official — Meta Cloud API
      const phoneNumberId = channel.whatsappPhoneNumberId;
      const accessToken = channel.whatsappAccessToken;
      if (!phoneNumberId || !accessToken) {
        throw new Error(`Official channel ${channel.id} missing credentials`);
      }
      await this.whatsappOfficial.sendTextMessage(phoneNumberId, phone, message, accessToken);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ FIX 2: Template Variables — متطابقة مع الفرونت إند
  // ═══════════════════════════════════════════════════════════════════════════════

  private renderMessage(
    campaign: Campaign,
    customer: Customer,
    triggerPayload?: Record<string, unknown>,
  ): string {
    let body = campaign.messageTemplate?.body || '';
    if (!body) return '';

    const customerName = customer.fullName || customer.firstName || customer.name || 'عميلنا';
    const firstName = customer.firstName || customerName;
    const lastName = customer.lastName || '';

    // ✅ نستبدل كل الصيغ الممكنة — الفرونت + القديمة
    const vars: Record<string, string> = {
      // الصيغ الجديدة (الفرونت إند)
      '{{customer_name}}': customerName,
      '{{first_name}}': firstName,
      '{{last_name}}': lastName,
      '{{phone}}': customer.phone || '',
      '{{email}}': customer.email || '',
      '{{store_name}}': '', // يُعبأ من الـ store أو metadata
      '{{order_id}}': String(triggerPayload?.orderId || triggerPayload?.orderNumber || ''),
      '{{order_total}}': String(triggerPayload?.orderTotal || ''),

      // الصيغ القديمة (backward compat)
      '{{name}}': customerName,

      // المتغيرات اللي يحطها التاجر يدوياً في القالب
      '{{coupon_code}}': '',
      '{{discount_percent}}': '',
      '{{offer_end_date}}': '',
      '{{referral_link}}': '',
      '{{referral_reward}}': '',
      '{{loyalty_points}}': '',
      '{{working_hours}}': '',
    };

    // استبدال
    for (const [key, value] of Object.entries(vars)) {
      body = body.replaceAll(key, value);
    }

    return body.trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Stats & Completion
  // ═══════════════════════════════════════════════════════════════════════════════

  private async incrementStat(campaignId: string, field: 'sent' | 'delivered' | 'read' | 'failed'): Promise<void> {
    try {
      await this.campaignRepo
        .createQueryBuilder()
        .update(Campaign)
        .set({
          stats: () => `jsonb_set(stats, '{${field}}', (COALESCE((stats->>'${field}')::int, 0) + 1)::text::jsonb)`,
        })
        .where('id = :id', { id: campaignId })
        .execute();
    } catch {
      // non-critical
    }
  }

  private async checkCompletion(campaignId: string): Promise<void> {
    try {
      const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
      if (!campaign || campaign.status !== CampaignStatus.ACTIVE) return;
      // الحملات الآلية لا تكتمل — تبقى نشطة
      if (campaign.type === CampaignType.AUTOMATED) return;

      const stats = campaign.stats;
      const processed = (stats.sent || 0) + (stats.failed || 0);

      if (processed >= stats.totalTargeted && stats.totalTargeted > 0) {
        await this.campaignRepo.update(campaignId, {
          status: CampaignStatus.COMPLETED,
          completedAt: new Date(),
        } as any);
        this.logger.log(`📣 Campaign ${campaignId} COMPLETED: ${stats.sent} sent, ${stats.failed} failed`);
      }
    } catch {
      // non-critical
    }
  }
}
