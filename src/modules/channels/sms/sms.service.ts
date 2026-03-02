/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - SMS Module                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { Channel } from '../entities/channel.entity';
import { Store } from '../../stores/entities/store.entity';

@Module({
  imports: [
    ConfigModule,
    // ✅ Channel entity: لتخزين credentials SMS بشكل دائم في DB
    // ✅ Store entity: لربط tenantId → storeId
    TypeOrmModule.forFeature([Channel, Store]),
    // ✅ HttpModule: لاستدعاء APIs المزودين (Unifonic, Taqnyat, Twilio ...)
    HttpModule.register({
      timeout: 12_000,
      maxRedirects: 3,
    }),
  ],
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
