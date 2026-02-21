import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WhatsappSettingsService } from '../services/whatsapp-settings.service';

export interface NotificationJobData {
  templateId?: string;
  content: string;
  channel: string;
  recipientPhone?: string;
  recipientEmail?: string;
  recipientUserId?: string;
  triggerEvent?: string;
}

@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly whatsappService: WhatsappSettingsService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { content, channel, recipientPhone, templateId, triggerEvent, recipientUserId } = job.data;

    this.logger.log(`Processing notification job ${job.id}`, {
      channel,
      triggerEvent,
      attempt: job.attemptsMade + 1,
    });

    if ((channel === 'whatsapp' || channel === 'both') && recipientPhone) {
      const result = await this.whatsappService.sendMessage(recipientPhone, content, {
        recipientUserId,
        templateId,
        triggerEvent,
      });

      if (!result.success) {
        throw new Error(`WhatsApp send failed for ${recipientPhone}`);
      }

      this.logger.log(`✅ WhatsApp sent to ${recipientPhone.slice(0, -4)}****`);
    }

    // Email channel — delegate to mail service (not implemented here, extend as needed)
    if ((channel === 'email' || channel === 'both') && job.data.recipientEmail) {
      this.logger.warn('Email channel not yet implemented in this processor');
    }
  }
}
