/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Billing Processor                                ║
 * ║                                                                                ║
 * ║  📌 معالج مهام الفوترة في الخلفية                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

import { PaymentService } from '../services/payment.service';
import { UsageTrackingService } from '../services/usage-tracking.service';

@Processor('billing')
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly usageTrackingService: UsageTrackingService,
  ) {
    super();
  }

  /**
   * معالجة المهام
   */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing billing job: ${job.name}`);

    switch (job.name) {
      case 'renew-subscription':
        return this.handleRenewal(job.data);
      
      case 'reset-usage':
        return this.handleUsageReset(job.data);
      
      case 'send-usage-alert':
        return this.handleUsageAlert(job.data);
      
      case 'expire-trial':
        return this.handleTrialExpiry(job.data);
      
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  /**
   * تجديد الاشتراك
   */
  private async handleRenewal(data: { subscriptionId: string }) {
    try {
      await this.paymentService.renewSubscription(data.subscriptionId);
      this.logger.log(`Renewed subscription: ${data.subscriptionId}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to renew: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * إعادة تعيين الاستخدام الشهري
   */
  private async handleUsageReset(data: { tenantId: string }) {
    await this.usageTrackingService.resetMonthlyUsage(data.tenantId);
    this.logger.log(`Reset usage for tenant: ${data.tenantId}`);
  }

  /**
   * إرسال تنبيه استخدام
   */
  private async handleUsageAlert(data: { 
    tenantId: string;
    percentageUsed: number;
  }) {
    // TODO: إرسال بريد أو إشعار
    this.logger.log(
      `Usage alert: Tenant ${data.tenantId} at ${data.percentageUsed}%`,
    );
  }

  /**
   * انتهاء الفترة التجريبية
   */
  private async handleTrialExpiry(data: { tenantId: string }) {
    // TODO: إرسال بريد وتحويل للخطة المجانية
    this.logger.log(`Trial expired for tenant: ${data.tenantId}`);
  }
}
