/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Module                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';

import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Rafiq-Platform/1.0',
      },
    }),

    BullModule.registerQueue({
      name: 'whatsapp',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    }),

    BullModule.registerQueue({
      name: 'whatsapp-outgoing',
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: {
          age: 172800,
        },
      },
    }),
  ],

  controllers: [WhatsAppController],

  providers: [WhatsAppService],

  exports: [WhatsAppService],
})
export class WhatsAppModule {}
