/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Module                              ║
 * ║                                                                                ║
 * ║  ✅ يدعم سلة وزد                                                               ║
 * ║  ✅ يحتوي على API Services للمزامنة                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

// Entity
import { Store } from './entities/store.entity';

// Controllers
import { StoresController } from './stores.controller';
import { SallaOAuthController } from './salla-oauth.controller';
import { ZidOAuthController } from './zid-oauth.controller';

// Services
import { StoresService } from './stores.service';
import { SallaOAuthService } from './salla-oauth.service';
import { SallaApiService } from './salla-api.service';
import { ZidOAuthService } from './zid-oauth.service';
import { ZidApiService } from './zid-api.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store]),
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    ConfigModule,
  ],
  controllers: [
    StoresController,
    SallaOAuthController,
    ZidOAuthController,
  ],
  providers: [
    StoresService,
    SallaOAuthService,
    SallaApiService,
    ZidOAuthService,
    ZidApiService,
  ],
  exports: [
    StoresService,
    SallaOAuthService,
    SallaApiService,
    ZidOAuthService,
    ZidApiService,
  ],
})
export class StoresModule {}
