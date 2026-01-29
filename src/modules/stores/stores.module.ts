/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Stores Module                              ║
 * ║                                                                                ║
 * ║  Module لإدارة متاجر سلة المرتبطة بالمنصة                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

// Controllers
import { StoresController } from './stores.controller';
import { SallaOAuthController } from './salla-oauth.controller';

// Services
import { StoresService } from './stores.service';
import { SallaApiService } from './salla-api.service';
import { SallaOAuthService } from './salla-oauth.service';

// Entities
import { Store } from './entities/store.entity';

/**
 * 📌 ماهو المتجر (Store) في سياق رفيق؟
 * 
 * Store = متجر سلة مرتبط بحساب في منصة رفيق
 * 
 * العلاقة:
 * - Tenant (مستخدم رفيق) → يملك → عدة Stores
 * - Store → مرتبط بـ → متجر سلة واحد
 * 
 * المتجر يحتوي على:
 * - بيانات الاتصال بـ API سلة (access token, refresh token)
 * - إعدادات الربط
 * - حالة الاتصال
 */

@Module({
  imports: [
    TypeOrmModule.forFeature([Store]),
    ConfigModule,
    
    // للتواصل مع API سلة
    HttpModule.register({
      timeout: 30000, // 30 ثانية
      maxRedirects: 5,
    }),
  ],

  controllers: [
    StoresController,
    SallaOAuthController,
  ],

  providers: [
    StoresService,
    SallaApiService,
    SallaOAuthService,
  ],

  exports: [
    StoresService,
    SallaApiService,
  ],
})
export class StoresModule {}

/**
 * 📌 Flow ربط متجر سلة:
 * 
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │                         SALLA OAUTH FLOW                                   │
 * ├─────────────────────────────────────────────────────────────────────────────┤
 * │                                                                             │
 * │  1. المستخدم يضغط "ربط متجر سلة" في لوحة التحكم                              │
 * │     ↓                                                                       │
 * │  2. نحوّله لصفحة OAuth سلة:                                                  │
 * │     https://accounts.salla.sa/oauth2/authorize?                             │
 * │       client_id=XXX&                                                        │
 * │       redirect_uri=https://api.rafiq.com/stores/salla/callback&             │
 * │       scope=offline_access&                                                 │
 * │       state=RANDOM_STATE                                                    │
 * │     ↓                                                                       │
 * │  3. سلة تعرض صفحة "السماح لتطبيق رفيق؟"                                      │
 * │     ↓                                                                       │
 * │  4. المستخدم يضغط "سماح"                                                    │
 * │     ↓                                                                       │
 * │  5. سلة تحوّل للـ callback URL مع code:                                      │
 * │     https://api.rafiq.com/stores/salla/callback?code=XXX&state=XXX          │
 * │     ↓                                                                       │
 * │  6. نستبدل الـ code بـ access_token & refresh_token                         │
 * │     ↓                                                                       │
 * │  7. نحفظ tokens في قاعدة البيانات                                           │
 * │     ↓                                                                       │
 * │  8. نجلب بيانات المتجر من API سلة                                           │
 * │     ↓                                                                       │
 * │  9. Done! المتجر مربوط ✅                                                    │
 * │                                                                             │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
