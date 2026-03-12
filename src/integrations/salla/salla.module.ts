/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFEQ PLATFORM — SallaIntegrationModule                     ║
 * ║                                                                                ║
 * ║  PLATFORM ISOLATION — سلة معزولة تماماً عن زد                                ║
 * ║                                                                                ║
 * ║  القاعدة الذهبية:                                                              ║
 * ║    أي إصلاح هنا لا يلمس زد بأي شكل                                           ║
 * ║                                                                                ║
 * ║  ARCHITECTURE:                                                                 ║
 * ║    هذا الـ module يعمل كـ Bridge بين طبقة AI وخدمات سلة الموجودة             ║
 * ║    الخدمات الأصلية (SallaApiService وغيرها) تعيش في StoresModule             ║
 * ║    الـ Webhooks و Controllers تعيش في WebhooksModule و StoresModule           ║
 * ║    هذا الـ module يُضيف فقط: SallaProductSearchAdapter للـ AI                 ║
 * ║                                                                                ║
 * ║  يحتوي على:                                                                   ║
 * ║    • SallaProductSearchAdapter — FIX #7: AI product search لسلة              ║
 * ║                                                                                ║
 * ║  يعتمد على (عبر imports):                                                      ║
 * ║    • StoresModule   → SallaApiService, SallaOAuthService, SallaStoreService   ║
 * ║    • WebhooksModule → SallaWebhooksService                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities
import { Store } from '@modules/stores/entities/store.entity';

// AI Adapter — ما يُضيفه هذا الـ module فقط
import { SallaProductSearchAdapter } from './salla-product-search.adapter';

// نستورد الـ modules الموجودة بدل تكرار providers
import { StoresModule } from '@modules/stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store]),

    // StoresModule يوفّر: SallaApiService, SallaOAuthService, SallaStoreService, ZidApiService
    // استخدام forwardRef لأن StoresModule يستورد AuthModule الذي يستورد StoresModule
    forwardRef(() => StoresModule),
  ],

  providers: [
    // ONLY what's unique to this module — لا يوجد أي تكرار مع StoresModule أو WebhooksModule
    SallaProductSearchAdapter,
  ],

  exports: [
    // SallaProductSearchAdapter → يُستخدم في AiModule عبر ProductSearchFactory
    SallaProductSearchAdapter,
  ],
})
export class SallaIntegrationModule {}
