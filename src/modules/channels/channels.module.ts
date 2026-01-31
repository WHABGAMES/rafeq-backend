/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Channels Module                            ║
 * ║                                                                                ║
 * ║  ⚠️ WhatsApp Baileys معطل مؤقتاً - يحتاج تثبيت المكتبات                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { Channel } from './entities/channel.entity';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
// ⚠️ WhatsApp Baileys معطل مؤقتاً
// import { WhatsAppBaileysService } from './whatsapp/whatsapp-baileys.service';

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
    // ⚠️ WhatsApp Baileys معطل مؤقتاً - شغله بعد تثبيت:
    // npm install @whiskeysockets/baileys qrcode @hapi/boom
    // WhatsAppBaileysService,
  ],
  exports: [
    ChannelsService,
  ],
})
export class ChannelsModule {}
