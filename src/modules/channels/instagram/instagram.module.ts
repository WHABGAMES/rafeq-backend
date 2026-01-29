/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Instagram Module                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';

import { InstagramService } from './instagram.service';

@Module({
  imports: [
    HttpModule.register({
      baseURL: 'https://graph.facebook.com/v18.0',
      timeout: 30000,
      headers: {
        'User-Agent': 'Rafiq-Platform/1.0',
      },
    }),

    BullModule.registerQueue({
      name: 'instagram',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 86400,
          count: 500,
        },
      },
    }),
  ],

  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
