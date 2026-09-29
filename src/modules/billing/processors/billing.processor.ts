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
import {
  asJsonRecord,
  getJsonNumber,
  getJsonString,
} from '../../../common/utils/json-record.util';

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
  async process(job: Job<unknown, unknown, string>): Promise<void> {
    this.logger.log(`Processing billing job: ${job.name}`);

    switch (job.name) {
      case 'renew-subscription': {
        const subscriptionId = this.requireStringField(job.data, 'subscriptionId', job.name);
        return this.handleRenewal({ subscriptionId });
      }
      
      case 'reset-usage': {
        const tenantId = this.requireStringField(job.data, 'tenantId', job.name);
        return this.handleUsageReset({ tenantId });
      }
      
      case 'send-usage-alert': {
        const tenantId = this.requireStringField(job.data, 'tenantId', job.name);
        const percentageUsed = this.requireNumberField(job.data, 'percentageUsed', job.name);
        return this.handleUsageAlert({ tenantId, percentageUsed });
      }
      
      case 'expire-trial': {
        const tenantId = this.requireStringField(job.data, 'tenantId', job.name);
        return this.handleTrialExpiry({ tenantId });
      }
      
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private requireStringField(data: unknown, field: string, jobName: string): string {
    const value = getJsonString(asJsonRecord(data), field);
    if (!value) {
      throw new Error(`Invalid ${jobName} job: ${field} must be a non-empty string`);
    }
    return value;
  }

  private requireNumberField(data: unknown, field: string, jobName: string): number {
    const value = getJsonNumber(asJsonRecord(data), field);
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`Invalid ${jobName} job: ${field} must be a finite number`);
    }
    return value;
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
