/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - CSAT Module                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';
import { CsatSurvey } from './entities/csat-survey.entity';
import { PlatformCapabilitiesModule } from '../platform-capabilities/platform-capabilities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CsatSurvey]),
    PlatformCapabilitiesModule,
  ],
  controllers: [CsatController],
  providers: [CsatService],
  exports: [CsatService],
})
export class CsatModule {}
