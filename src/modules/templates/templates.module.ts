/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Templates Module                                 ║
 * ║  ✅ v2: تصدير TypeOrmModule للـ modules الأخرى                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageTemplate } from '@database/entities';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([MessageTemplate])],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [
    TemplatesService,
    TypeOrmModule, // ✅ تصدير لتوفير MessageTemplate Repository للـ modules الأخرى
  ],
})
export class TemplatesModule {}
