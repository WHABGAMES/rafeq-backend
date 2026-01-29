/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Billing Module                             ║
 * ║                                                                                ║
 * ║  📌 هذا الـ Module مسؤول عن:                                                    ║
 * ║  - إدارة خطط الاشتراك (Subscription Plans)                                      ║
 * ║  - إدارة اشتراكات المستأجرين (Subscriptions)                                    ║
 * ║  - معالجة المدفوعات (Stripe/Moyasar)                                           ║
 * ║  - تتبع الاستخدام (Usage Tracking)                                              ║
 * ║  - إنفاذ الحصص (Quota Enforcement)                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';
import { Subscription } from '@database/entities/subscription.entity';

// Services
import { BillingService } from './billing.service';
import { SubscriptionPlanService } from './services/subscription-plan.service';
import { UsageTrackingService } from './services/usage-tracking.service';
import { PaymentService } from './services/payment.service';

// Controllers
import { BillingController } from './billing.controller';
import { PlansController } from './controllers/plans.controller';
import { WebhooksController } from './controllers/payment-webhooks.controller';

// Queue Processors
import { BillingProcessor } from './processors/billing.processor';

// Related Modules
import { TenantsModule } from '@modules/tenants/tenants.module';

@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════════════════
    // 🗄️ TypeORM - تسجيل الـ Entities
    // ═══════════════════════════════════════════════════════════════════════════════
    TypeOrmModule.forFeature([
      SubscriptionPlan,
      Subscription,
    ]),

    // ═══════════════════════════════════════════════════════════════════════════════
    // 📬 BullMQ - طوابير الفوترة
    // ═══════════════════════════════════════════════════════════════════════════════
    BullModule.registerQueue({
      name: 'billing',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,  // 5 ثواني
        },
      },
    }),

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔗 Related Modules
    // ═══════════════════════════════════════════════════════════════════════════════
    forwardRef(() => TenantsModule),
  ],

  controllers: [
    BillingController,
    PlansController,
    WebhooksController,
  ],

  providers: [
    BillingService,
    SubscriptionPlanService,
    UsageTrackingService,
    PaymentService,
    BillingProcessor,
  ],

  exports: [
    BillingService,
    SubscriptionPlanService,
    UsageTrackingService,
  ],
})
export class BillingModule {}
