import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpConfig, OtpRequestLog } from './entities/otp-config.entity';
import { Store } from '../stores/entities/store.entity';
import { OtpRelayService } from './otp-relay.service';
import { OtpRelayController, OtpPublicController } from './otp-relay.controller';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpConfig, OtpRequestLog, Store]),
    StoresModule,
  ],
  controllers: [OtpRelayController, OtpPublicController],
  providers: [OtpRelayService],
  exports: [OtpRelayService],
})
export class OtpRelayModule {}
