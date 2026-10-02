import { Injectable } from '@nestjs/common';
import { Interval, Timeout } from '@nestjs/schedule';
import { WhatsappSettingsService } from './whatsapp-settings.service';

const WHATSAPP_HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Keeps scheduling concerns separate from settings persistence and delivery. */
@Injectable()
export class WhatsappConnectionMonitorService {
  constructor(private readonly whatsappSettingsService: WhatsappSettingsService) {}

  @Timeout(15_000)
  initialCheck(): Promise<void> {
    return this.whatsappSettingsService.monitorConnections();
  }

  @Interval(WHATSAPP_HEALTH_CHECK_INTERVAL_MS)
  checkConnections(): Promise<void> {
    return this.whatsappSettingsService.monitorConnections();
  }
}
