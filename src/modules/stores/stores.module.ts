/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Module                              ║
 * ║                                                                                ║
 * ║  Module لإدارة المتاجر المرتبطة بالمنصة (سلة + زد)                              ║
 * ║  ✅ مع دعم Auto Registration للتجار                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthModule } from '../auth/auth.module';

// Controllers
import { StoresController } from './stores.controller';
import { SallaOAuthController } from './salla-oauth.controller';
import { ZidOAuthController } from './zid-oauth.controller';

// Services
import { StoresService } from './stores.service';
import { SallaApiService } from './salla-api.service';
import { SallaOAuthService } from './salla-oauth.service';
import { ZidApiService } from './zid-api.service';
import { ZidOAuthService } from './zid-oauth.service';

// Entities
import { Store } from './entities/store.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store]),
    ConfigModule,
    TenantsModule,
    forwardRef(() => AuthModule),
    
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
  ],

  controllers: [
    StoresController,
    SallaOAuthController,
    ZidOAuthController,
  ],

  providers: [
    StoresService,
    // Salla
    SallaApiService,
    SallaOAuthService,
    // Zid
    ZidApiService,
    ZidOAuthService,
  ],

  exports: [
    StoresService,
    SallaApiService,
    SallaOAuthService,
    ZidApiService,
    ZidOAuthService,
  ],
})
export class StoresModule {}
