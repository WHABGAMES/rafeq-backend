/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Email Module                                     ║
 * ║  ✅ v2: إضافة Channel entity + HttpModule لتنفيذ إرسال حقيقي                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { Channel } from '../entities/channel.entity';
import { Store } from '../../stores/entities/store.entity';

@Module({
  imports: [
    ConfigModule,
    // ✅ Channel entity: لتخزين إعدادات البريد بشكل دائم في DB
    // ✅ Store entity:   لربط tenantId → storeId
    TypeOrmModule.forFeature([Channel, Store]),
    // ✅ HttpModule: لاستدعاء APIs المزودين (SendGrid, Mailgun, SES)
    HttpModule.register({
      timeout:     15_000,
      maxRedirects: 3,
    }),
  ],
  controllers: [EmailController],
  providers:   [EmailService],
  exports:     [EmailService],
})
export class EmailModule {}
