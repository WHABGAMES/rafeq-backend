/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Element Events Queue Processor                       ║
 * ║                                                                                ║
 * ║  BullMQ worker that processes element tracking events.                        ║
 * ║  Runs as a separate worker for horizontal scaling.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { ElementTrackingService, ELEMENT_EVENTS_QUEUE } from '../services/element-tracking.service';

@Processor(ELEMENT_EVENTS_QUEUE, {
  concurrency: 10,         // Process 10 events concurrently
  limiter: {
    max: 500,              // Max 500 events per second
    duration: 1000,
  },
})
export class ElementEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(ElementEventsProcessor.name);

  constructor(
    private readonly trackingService: ElementTrackingService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      await this.trackingService.processEvent(job.data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process event job ${job.id}: ${msg}`);
      throw error; // BullMQ will retry based on job config
    }
  }
}
