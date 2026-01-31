/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Module                            ║
 * ║                                                                                ║
 * ║  ✅ يشمل: ChannelsService, WhatsAppBaileysService                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { Channel } from './entities/channel.entity';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { WhatsAppBaileysService } from './whatsapp-baileys.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Channel]),
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    ConfigModule,
  ],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    WhatsAppBaileysService,
  ],
  exports: [
    ChannelsService,
    WhatsAppBaileysService,
  ],
})
export class ChannelsModule {}
