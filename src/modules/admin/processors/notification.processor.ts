import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { WhatsappSettingsService } from '../services/whatsapp-settings.service';

export interface NotificationJobData {
  templateId?: string;
  content: string;
  channel: string;
  recipientPhone?: string;
  recipientEmail?: string;
  recipientUserId?: string;
  triggerEvent?: string;
  tenantId?: string;
  adminAlertRecipientId?: string;
}

@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly whatsappService: WhatsappSettingsService,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { content, channel, recipientPhone, templateId, triggerEvent, recipientUserId, tenantId } = job.data;

    this.logger.log(`Processing notification job ${job.id}`, {
      channel,
      triggerEvent,
      tenantId: tenantId || 'global',
      attempt: job.attemptsMade + 1,
    });

    if ((channel === 'whatsapp' || channel === 'both') && recipientPhone) {
      const result = await this.whatsappService.sendMessage(recipientPhone, content, {
        recipientUserId,
        templateId,
        triggerEvent,
        tenantId,
      });

      if (!result.success) {
        throw new Error(`WhatsApp send failed for ${recipientPhone.slice(0, -4)}****`);
      }

      this.logger.log(`✅ WhatsApp sent to ${recipientPhone.slice(0, -4)}****`);

      if (job.data.adminAlertRecipientId) {
        try {
          await this.dataSource.query(
            `UPDATE admin_alert_recipients
             SET sent_count = sent_count + 1,
                 last_sent_at = NOW(),
                 last_failure_reason = NULL
             WHERE id = $1`,
            [job.data.adminAlertRecipientId],
          );
        } catch (recordingError: unknown) {
          // Delivery already succeeded. Throwing here would make BullMQ resend the
          // same WhatsApp message merely because analytics persistence failed.
          const message = recordingError instanceof Error
            ? recordingError.message
            : String(recordingError);
          this.logger.error(`Admin alert delivered but success metric update failed: ${message}`);
        }
      }
    }

    // Email channel — delegate to mail service (not implemented here, extend as needed)
    if ((channel === 'email' || channel === 'both') && job.data.recipientEmail) {
      this.logger.warn('Email channel not yet implemented in this processor');
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJobData> | undefined, error: Error): Promise<void> {
    if (!job?.data.adminAlertRecipientId) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    try {
      await this.dataSource.query(
        `UPDATE admin_alert_recipients
         SET failed_count = failed_count + 1,
             last_failed_at = NOW(),
             last_failure_reason = $2
         WHERE id = $1`,
        [job.data.adminAlertRecipientId, error.message.slice(0, 500)],
      );
    } catch (recordingError: unknown) {
      const message = recordingError instanceof Error ? recordingError.message : String(recordingError);
      this.logger.error(`Failed to record final admin alert delivery failure: ${message}`);
    }
  }
}
