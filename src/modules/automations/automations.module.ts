/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Automations Module                               ║
 * ║  ✅ v2: قاعدة بيانات حقيقية + تكامل مع القنوات                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { Automation } from './entities/automation.entity';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Automation]),
    ChannelsModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
