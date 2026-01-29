/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Discord Module                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { DiscordService } from './discord.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'discord',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 86400,
          count: 500,
        },
      },
    }),
  ],

  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
