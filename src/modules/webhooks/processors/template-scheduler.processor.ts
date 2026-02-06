/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║        RAFIQ PLATFORM - Template Scheduler Processor                           ║
 * ║                                                                                ║
 * ║  📌 يُنفّذ الإرسال المؤجل عند حلول الموعد                                     ║
 * ║  ✅ يتحقق من الحالة قبل الإرسال (لم يُلغَ)                                    ║
 * ║  ✅ يرسل عبر واتساب مع استبدال المتغيرات                                       ║
 * ║  ✅ يستخدم نص التاجر المخصص إن وُجد                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { MessageTemplate } from '@database/entities/message-template.entity';
import { Channel, ChannelType, ChannelStatus } from '../../channels/entities/channel.entity';
import { ChannelsService } from '../../channels/channels.service';
import {
  ScheduledTemplateSend,
  ScheduledSendStatus,
} from '@database/entities/scheduled-template-send.entity';
import { TemplateSchedulerService, ScheduleTemplateJobData } from '../template-scheduler.service';

@Injectable()
@Processor('template-scheduler', {
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000,
  },
})
export class TemplateSchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(TemplateSchedulerProcessor.name);

  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,

    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,

    @InjectRepository(ScheduledTemplateSend)
    private readonly scheduledSendRepo: Repository<ScheduledTemplateSend>,

    private readonly channelsService: ChannelsService,
    private readonly schedulerService: TemplateSchedulerService,
  ) {
    super();
  }

  async process(job: Job<ScheduleTemplateJobData>): Promise<void> {
    const { scheduledSendId, templateId, tenantId, storeId, customerPhone, payload } = job.data;

    this.logger.log(`⏰ Processing scheduled send: ${scheduledSendId}`, {
      templateId,
      customerPhone,
    });

    try {
      // 1️⃣ تحقق أن الإرسال لم يُلغَ
      const scheduledSend = await this.schedulerService.findById(scheduledSendId);

      if (!scheduledSend) {
        this.logger.warn(`⚠️ Scheduled send not found: ${scheduledSendId}`);
        return;
      }

      if (scheduledSend.status !== ScheduledSendStatus.PENDING) {
        this.logger.log(
          `⏭️ Skipping: status is ${scheduledSend.status} (not pending)`,
        );
        return;
      }

      // 2️⃣ جلب القالب (آخر نسخة — يحترم تعديلات التاجر)
      const template = await this.templateRepo.findOne({
        where: { id: templateId, tenantId },
      });

      if (!template) {
        await this.schedulerService.markAsFailed(scheduledSendId, 'القالب غير موجود');
        return;
      }

      // ✅ تحقق أن القالب لا يزال مفعّل
      if (!['active', 'approved'].includes(template.status)) {
        this.logger.warn(`⚠️ Template "${template.name}" is disabled (${template.status}) - skipping`);
        await this.schedulerService.markAsFailed(scheduledSendId, `القالب معطّل (${template.status})`);
        return;
      }

      // 3️⃣ البحث عن قناة واتساب
      const channel = await this.findActiveWhatsAppChannel(storeId);

      if (!channel) {
        await this.schedulerService.markAsFailed(scheduledSendId, 'لا توجد قناة واتساب متصلة');
        return;
      }

      // 4️⃣ ✅ استبدال المتغيرات — يستخدم body القالب (نص التاجر المخصص إن وُجد)
      const message = this.replaceVariables(template.body, payload);

      // 5️⃣ إرسال عبر واتساب
      this.logger.log(`📤 Sending scheduled template: "${template.name}" → ${customerPhone}`);

      await this.channelsService.sendWhatsAppMessage(
        channel.id,
        customerPhone,
        message,
      );

      // 6️⃣ تحديث الحالة
      await this.schedulerService.markAsSent(scheduledSendId, message);

      // 7️⃣ تحديث إحصائيات القالب
      await this.incrementUsage(templateId);

      this.logger.log(
        `✅ Scheduled send completed: "${template.name}" → ${customerPhone}`,
      );

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(
        `❌ Scheduled send failed: ${scheduledSendId} - ${msg}`,
        { stack: error instanceof Error ? error.stack : undefined },
      );

      await this.schedulerService.markAsFailed(scheduledSendId, msg);
      throw error; // BullMQ will retry based on attempts config
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async findActiveWhatsAppChannel(storeId?: string): Promise<Channel | null> {
    if (!storeId) return null;
    return this.channelRepo.findOne({
      where: [
        { storeId, type: ChannelType.WHATSAPP_QR, status: ChannelStatus.CONNECTED },
        { storeId, type: ChannelType.WHATSAPP_OFFICIAL, status: ChannelStatus.CONNECTED },
      ],
    });
  }

  /**
   * ✅ استبدال المتغيرات — نفس منطق template-dispatcher
   * يستخدم body القالب كما هو (نص التاجر أو الافتراضي)
   */
  private replaceVariables(body: string, data: Record<string, unknown>): string {
    let message = body;

    const orderObj = (data.order || {}) as Record<string, unknown>;
    const customer = (data.customer || orderObj.customer || {}) as Record<string, unknown>;
    const urls = (data.urls || orderObj.urls || {}) as Record<string, unknown>;

    const variables: Record<string, string> = {
      customer_name: String(customer.first_name || customer.name || data.customerName || 'عميلنا الكريم'),
      customer_first_name: String(customer.first_name || data.customerName || 'عميلنا'),
      customer_phone: String(customer.mobile || customer.phone || ''),
      customer_email: String(customer.email || ''),
      order_id: String(data.reference_id || orderObj.reference_id || data.order_number || orderObj.order_number || data.id || orderObj.id || data.orderId || ''),
      order_total: this.formatAmount(data.total || orderObj.total),
      order_status: String(data.status || data.newStatus || orderObj.status || ''),
      order_date: new Date().toLocaleDateString('ar-SA'),
      order_tracking: String(urls.tracking || data.tracking_url || orderObj.tracking_url || ''),
      tracking_number: String(data.tracking_number || data.trackingNumber || orderObj.tracking_number || ''),
      shipping_company: String(data.shipping_company || data.shippingCompany || orderObj.shipping_company || ''),
      store_name: String(data.store_name || orderObj.store_name || 'متجرنا'),
      store_url: String(data.store_url || ''),
      cart_total: this.formatAmount(data.total || data.cartTotal || orderObj.total),
      cart_link: String(data.cart_url || data.checkout_url || orderObj.checkout_url || ''),
      product_name: String(data.name || data.productName || ''),
      product_price: this.formatAmount(data.price || orderObj.price),
      payment_link: String(data.payment_url || data.checkout_url || orderObj.payment_url || ''),
    };

    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }

    message = message.replace(/\{\{[^}]+\}\}/g, '');
    return message.trim();
  }

  private formatAmount(amount: unknown): string {
    if (!amount) return '0';
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (isNaN(num)) return String(amount);
    return num.toLocaleString('ar-SA');
  }

  private async incrementUsage(templateId: string): Promise<void> {
    try {
      await this.templateRepo
        .createQueryBuilder()
        .update(MessageTemplate)
        .set({
          stats: () =>
            `jsonb_set(COALESCE(stats, '{"usageCount":0}'::jsonb), '{usageCount}', (COALESCE((stats->>'usageCount')::int, 0) + 1)::text::jsonb)`,
        })
        .where('id = :id', { id: templateId })
        .execute();
    } catch {
      this.logger.warn(`Failed to increment usage for template ${templateId}`);
    }
  }
}
