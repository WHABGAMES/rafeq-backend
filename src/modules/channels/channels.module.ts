/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Module                            ║
 * ║                                                                                ║
 * ║  ✅ إصلاحات:                                                                   ║
 * ║  - إزالة EventEmitterModule.forRoot() المكرر (موجود في AppModule)              ║
 * ║  - الاحتفاظ بباقي التبعيات كما هي                                              ║
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
    TypeOrmModule, // ✅ تصدير TypeOrmModule ليستخدمه WhatsAppModule
  ],
})
export class ChannelsModule {}
