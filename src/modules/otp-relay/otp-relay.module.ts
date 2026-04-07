import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpConfig, OtpRequestLog } from './entities/otp-config.entity';
import { OtpInventoryItem, OtpCompensation } from './entities/otp-inventory.entity';
import { Store } from '../stores/entities/store.entity';
import { Channel } from '../channels/entities/channel.entity';
import { OtpRelayService } from './otp-relay.service';
import { OtpInventoryService } from './otp-inventory.service';
import { TelegramOtpClientService } from './telegram-otp-client.service';
import { OtpRelayController, OtpPublicController } from './otp-relay.controller';
import { StoresModule } from '../stores/stores.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpConfig, OtpRequestLog, OtpInventoryItem, OtpCompensation, Store, Channel]),
    StoresModule,
    ChannelsModule,
  ],
  controllers: [OtpRelayController, OtpPublicController],
  providers: [OtpRelayService, OtpInventoryService, TelegramOtpClientService],
  exports: [OtpRelayService, OtpInventoryService, TelegramOtpClientService],
})
export class OtpRelayModule {}
