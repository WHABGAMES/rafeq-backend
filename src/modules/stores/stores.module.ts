/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM — Stores Module                              ║
 * ║                                                                                ║
 * ║  البنية الجديدة (مفصولة):                                                      ║
 * ║    • SallaStoreService  ← كل ما يخص سلة                                      ║
 * ║    • ZidStoreService    ← كل ما يخص زد                                        ║
 * ║    • StoresService      ← Facade مشترك                                        ║
 * ║                                                                                ║
 * ║  📁 src/modules/stores/stores.module.ts                                       ║
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
import { ApiConnectController } from './api-connect.controller';

// Shared Facade
import { StoresService } from './stores.service';

// ✅ Platform-specific services (معزولة عن بعض)
import { SallaStoreService } from './salla-store.service';
import { ZidStoreService } from './zid-store.service';

// OAuth & API
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
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
  ],

  controllers: [
    StoresController,
    SallaOAuthController,
    ZidOAuthController,
    ApiConnectController,
  ],

  providers: [
    // ✅ Facade (يستخدمه باقي الـ modules)
    StoresService,

    // ✅ Platform-specific (معزولة)
    SallaStoreService,
    ZidStoreService,

    // OAuth & API
    SallaApiService,
    SallaOAuthService,
    ZidApiService,
    ZidOAuthService,
  ],

  exports: [
    StoresService,       // الواجهة الموحدة للخارج
    SallaStoreService,   // لو module آخر احتاج Salla مباشرة
    ZidStoreService,     // لو module آخر احتاج Zid مباشرة
    SallaApiService,
    SallaOAuthService,
    ZidApiService,
    ZidOAuthService,
  ],
})
export class StoresModule {}
