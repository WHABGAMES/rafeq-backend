/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Campaigns Module v2                              ║
 * ║                                                                                ║
 * ║  ✅ FIX: إضافة ChannelsModule لدعم WhatsApp QR (Baileys)                     ║
 * ║  ✅ FIX: إضافة Store entity للـ Processor                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Campaign, Customer, Channel } from '@database/entities';
import { Store } from '@modules/stores/entities/store.entity';

import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsProcessor } from './campaigns.processor';
import { CampaignsScheduler } from './campaigns.scheduler';

// ✅ FIX: WhatsApp Official API
import { WhatsAppModule } from '@modules/channels/whatsapp/whatsapp.module';
// ✅ FIX: WhatsApp QR (Baileys) — عبر ChannelsModule
import { ChannelsModule } from '@modules/channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, Customer, Channel, Store]),

    // ✅ WhatsApp Official API
    WhatsAppModule,

    // ✅ FIX: ChannelsModule يُصدّر WhatsAppBaileysService
    // بدونه الـ Processor لا يقدر يرسل عبر QR channels
    ChannelsModule,

    BullModule.registerQueue({
      name: 'campaigns',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 7 * 24 * 3600,
          count: 10000,
        },
        removeOnFail: {
          age: 30 * 24 * 3600,
        },
      },
    }),
  ],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    CampaignsProcessor,
    CampaignsScheduler,
  ],
  exports: [CampaignsService],
})
export class CampaignsModule {}
