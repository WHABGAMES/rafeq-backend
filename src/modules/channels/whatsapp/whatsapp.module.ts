/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WhatsApp Module                                  ║
 * ║                                                                                ║
 * ║  ✅ v3 — إصلاحات:                                                              ║
 * ║  FIX-1: حذف طابوري 'whatsapp' و'whatsapp-outgoing' الفارغَين                   ║
 * ║         لم يكن لهما Processor — الرسائل كانت تتراكم في Redis بلا معالجة       ║
 * ║         الإرسال يتم مباشرة عبر ChannelsService.sendWhatsAppMessage             ║
 * ║  FIX-2: ChannelsModule يُصدّر WhatsAppBaileysService — لا داعي لإعادة تسجيله  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { Channel } from '../entities/channel.entity';
import { WhatsappSettings } from '../../admin/entities/whatsapp-settings.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Channel, WhatsappSettings]),
    ConfigModule,

    HttpModule.register({
      timeout: 30_000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Rafiq-Platform/1.0' },
    }),

    // ✅ لا BullMQ queues هنا — حُذفت لأنها لم تكن لها processors
    //    الإرسال يتم مباشرة عبر WhatsAppService/ChannelsService
    //    طابور 'messaging' في MessagingModule هو المسؤول عن retry logic
  ],

  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
