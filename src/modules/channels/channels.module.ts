/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Module                            ║
 * ║                                                                                ║
 * ║  ✅ v3: إضافة WhatsAppCleanupListener لتنظيف المحادثات عند الفصل            ║
 * ║  ✅ إزالة EventEmitterModule.forRoot() المكرر (موجود في AppModule)            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { Channel } from './entities/channel.entity';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { WhatsAppBaileysService } from './whatsapp/whatsapp-baileys.service';
import { WhatsAppCleanupListener } from './listeners/whatsapp-cleanup.listener';

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
    WhatsAppCleanupListener,
  ],
  exports: [
    ChannelsService,
    WhatsAppBaileysService,
    WhatsAppCleanupListener,
    TypeOrmModule,
  ],
})
export class ChannelsModule {}
