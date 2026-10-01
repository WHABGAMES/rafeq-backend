/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Settings Module                                  ║
 * ║  ✅ v2: قاعدة بيانات حقيقية للإعدادات لكل متجر                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StoreSettings } from './entities/store-settings.entity';
import { PlatformCapabilitiesModule } from '../platform-capabilities/platform-capabilities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StoreSettings]),
    PlatformCapabilitiesModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
