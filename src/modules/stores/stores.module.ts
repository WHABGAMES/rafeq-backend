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
import { AuthModule } from '../auth/auth.module'; // ✅ إضافة AuthModule للتسجيل التلقائي

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
    forwardRef(() => AuthModule), // ✅ forwardRef لتجنب circular dependency
    
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

  // ✅ تصدير جميع الـ Services المطلوبة من modules أخرى
  exports: [
    StoresService,
    // Salla
    SallaApiService,
    SallaOAuthService,  // ✅ مطلوب في WebhooksModule
    // Zid
    ZidApiService,
    ZidOAuthService,    // ✅ للاكتمال
  ],
})
export class StoresModule {}

/**
 * 📌 Flow ربط متجر:
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                         OAUTH FLOW (Salla / Zid)                           │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                             │
 * │  1. المستخدم يضغط "ربط متجر" في لوحة التحكم                                  │
 * │     ↓                                                                       │
 * │  2. نحوّله لصفحة OAuth:                                                      │
 * │     - سلة: https://accounts.salla.sa/oauth2/authorize                       │
 * │     - زد: https://oauth.zid.sa/oauth/authorize                              │
 * │     ↓                                                                       │
 * │  3. المستخدم يوافق على الصلاحيات                                            │
 * │     ↓                                                                       │
 * │  4. Redirect للـ callback مع code                                           │
 * │     ↓                                                                       │
 * │  5. نستبدل الـ code بـ tokens                                               │
 * │     ↓                                                                       │
 * │  6. نحفظ المتجر في قاعدة البيانات                                           │
 * │     ↓                                                                       │
 * │  7. ✅ Auto Registration - إنشاء حساب للتاجر + إرسال بيانات الدخول           │
 * │     ↓                                                                       │
 * │  8. Done! المتجر مربوط + التاجر مسجل ✅                                       │
 * │                                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
