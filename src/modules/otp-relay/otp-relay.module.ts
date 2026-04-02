import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpConfig, OtpRequestLog } from './entities/otp-config.entity';
import { Store } from '../stores/entities/store.entity';
import { Channel } from '../channels/entities/channel.entity';
import { OtpRelayService } from './otp-relay.service';
import { OtpRelayController, OtpPublicController } from './otp-relay.controller';
import { StoresModule } from '../stores/stores.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpConfig, OtpRequestLog, Store, Channel]),
    StoresModule,
    ChannelsModule,
  ],
  controllers: [OtpRelayController, OtpPublicController],
  providers: [OtpRelayService],
  exports: [OtpRelayService],
})
export class OtpRelayModule {}
