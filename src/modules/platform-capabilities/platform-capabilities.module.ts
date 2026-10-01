import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store } from '../stores/entities/store.entity';
import { PlatformFeature } from './entities/platform-feature.entity';
import { PlatformCapabilitiesController } from './platform-capabilities.controller';
import { PlatformCapabilitiesService } from './platform-capabilities.service';
import { PlatformFeatureGuard } from './platform-feature.guard';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformFeature, Store]), BillingModule],
  controllers: [PlatformCapabilitiesController],
  providers: [PlatformCapabilitiesService, PlatformFeatureGuard],
  exports: [PlatformCapabilitiesService, PlatformFeatureGuard],
})
export class PlatformCapabilitiesModule {}
