/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Widget Module                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WidgetSettings } from './widget-settings.entity';
import { WidgetService } from './widget.service';
import { WidgetPublicController, WidgetSettingsController } from './widget.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WidgetSettings]),
  ],
  controllers: [
    WidgetPublicController,
    WidgetSettingsController,
  ],
  providers: [WidgetService],
  exports: [WidgetService],
})
export class WidgetModule {}
