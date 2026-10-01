/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Short Links Module                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ShortLink, LinkClick } from './short-link.entity';
import { ShortLinksService } from './short-links.service';
import { ShortLinksController, ShortLinkRedirectController } from './short-links.controller';
import { PlatformCapabilitiesModule } from '../platform-capabilities/platform-capabilities.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShortLink, LinkClick]),
    PlatformCapabilitiesModule,
  ],
  controllers: [
    ShortLinkRedirectController,
    ShortLinksController,
  ],
  providers: [ShortLinksService],
  exports: [ShortLinksService],
})
export class ShortLinksModule {}
