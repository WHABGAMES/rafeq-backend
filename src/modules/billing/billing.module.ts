/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Billing Module (v2)                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';
import { Subscription } from '@database/entities/subscription.entity';
import { Tenant } from '@database/entities/tenant.entity';

// Existing services
import { BillingService } from './billing.service';
import { SubscriptionPlanService } from './services/subscription-plan.service';
import { UsageTrackingService } from './services/usage-tracking.service';
import { PaymentService } from './services/payment.service';

// ✅ NEW: Subscription management
import { SubscriptionManagementService } from './services/subscription-management.service';

// ✅ NEW: Subscription expiry cron
import { SubscriptionExpiryService } from './services/subscription-expiry.service';

// Existing controllers
import { BillingController } from './billing.controller';
import { PlansController } from './controllers/plans.controller';
import { WebhooksController } from './controllers/payment-webhooks.controller';

// ✅ NEW: Subscription info API
import { SubscriptionInfoController } from './subscription-info.controller';

// ✅ NEW: Guards
import { PlanGuard } from './guards/subscription.guard';

// ✅ NEW: Webhook listener
import { SubscriptionWebhookListener } from './listeners/subscription-webhook.listener';

// Existing processor
import { BillingProcessor } from './processors/billing.processor';

// Related modules
import { TenantsModule } from '@modules/tenants/tenants.module';

@Module({
  imports: [
    // ✅ Tenant مطلوب هنا لأن SubscriptionManagementService يستخدم @InjectRepository(Tenant)
    TypeOrmModule.forFeature([
      SubscriptionPlan,
      Subscription,
      Tenant,
    ]),

    BullModule.registerQueue({
      name: 'billing',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),

    forwardRef(() => TenantsModule),
  ],

  controllers: [
    BillingController,
    PlansController,
    WebhooksController,
    SubscriptionInfoController,
  ],

  providers: [
    BillingService,
    SubscriptionPlanService,
    UsageTrackingService,
    PaymentService,
    SubscriptionManagementService,
    SubscriptionExpiryService,
    PlanGuard,
    SubscriptionWebhookListener,
    BillingProcessor,
  ],

  exports: [
    BillingService,
    SubscriptionPlanService,
    UsageTrackingService,
    SubscriptionManagementService,
    SubscriptionExpiryService,
    PlanGuard,
  ],
})
export class BillingModule {}
