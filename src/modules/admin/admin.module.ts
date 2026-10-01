/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           Rafeq Platform — Admin Module                      ║
 * ║           Production-ready | Audited 2026-02-21              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FIX [C-2]: JWT Secret startup guard — يوقف التطبيق فورًا
 * إذا لم تكن المتغيرات البيئية مضبوطة في production.
 * بدون هذا الفحص يمكن لـ jsonwebtoken استخدام 'undefined'
 * كـ secret → أي شخص يمكنه تزوير admin tokens.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

// Entities
import { AdminUser } from './entities/admin-user.entity';
import { AuditLog } from './entities/audit-log.entity';
import { MergeHistory } from './entities/merge-history.entity';
import { WhatsappSettings } from './entities/whatsapp-settings.entity';
import { MessageTemplate } from './entities/message-template.entity';
import { MessageLog } from './entities/message-log.entity';
import { MaintenancePage } from './entities/maintenance-page.entity';
import { AdminAlertRecipient } from './entities/admin-alert-recipient.entity';
import { Conversation, Message, Channel } from '@database/entities';

// Services
import { AuditService } from './services/audit.service';
import { AdminUsersService } from './services/admin-users.service';
import { WhatsappSettingsService } from './services/whatsapp-settings.service';
import { NotificationService } from './services/notification.service';
import { MaintenanceService } from './services/maintenance.service';
import { AdminAlertsService } from './services/admin-alerts.service';
import { AdminTwoFactorSecretService } from './services/admin-two-factor-secret.service';
import { AdminLoginProtectionService } from './services/admin-login-protection.service';

// Controllers
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import {
  AdminStoresController,
  WhatsappController,
  TemplatesController,
  AuditLogsController,
} from './controllers/admin.controllers';
import { SystemHealthController } from './controllers/system-health.controller';
import { AdminAlertsController } from './controllers/admin-alerts.controller';

// ✅ NEW: Admin Subscriptions Controller
import { AdminSubscriptionsController } from './controllers/admin-subscriptions.controller';

// Guards
import { AdminJwtGuard, AdminPermissionGuard } from './guards/admin.guards';

// Processor & Listeners
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationEventListener } from './listeners/notification-event.listener';
import { AdminAlertsListener } from './listeners/admin-alerts.listener';

// ✅ NEW: BillingModule — مطلوب لـ SubscriptionManagementService في AdminSubscriptionsController
import { BillingModule } from '../billing/billing.module';

// ✅ NEW: InboxModule — مطلوب لصندوق رسائل الأدمن
import { InboxModule } from '../inbox/inbox.module';

// ✅ NEW: Admin Inbox Controller
import { AdminInboxController } from './controllers/admin-inbox.controller';

// ✅ NEW: Maintenance Controllers
import { MaintenancePublicController, MaintenanceAdminController } from './controllers/maintenance.controller';

// ✅ NEW: Telegram OTP Admin
import { AdminTelegramController } from './controllers/admin-telegram.controller';
import { OtpRelayModule } from '../otp-relay/otp-relay.module';
import { PlatformCapabilitiesModule } from '../platform-capabilities/platform-capabilities.module';
import { AdminPlatformFeaturesController } from './controllers/admin-platform-features.controller';
import { getAdminJwtSecret } from './admin-jwt-secret';

// ─── [C-2] Startup Validation ─────────────────────────────────────────────────
// يُنفَّذ قبل أي شيء عند تحميل الـ module
const jwtSecret = getAdminJwtSecret();

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminUser,
      AuditLog,
      MergeHistory,
      WhatsappSettings,
      MessageTemplate,
      MessageLog,
      Conversation,  // ✅ مطلوب لـ AdminInboxController
      Message,       // ✅ مطلوب لـ AdminInboxController
      Channel,       // ✅ مطلوب لـ AdminInboxController — فلترة بالرقم الإداري
      MaintenancePage, // ✅ مطلوب لنظام الصيانة الجزئي
      AdminAlertRecipient, // ✅ NEW: جدول مستقبلي تنبيهات الإدارة
    ]),

    // ✅ JwtModule يستخدم نفس الـ secret المُتحقَّق منه أعلاه
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: '8h' },
    }),

    // ✅ مطلوب لـ @Cron() في NotificationEventListener
    ScheduleModule.forRoot(),

    // ✅ مطلوب لـ @OnEvent() في NotificationEventListener
    // بدونه الإشعارات التلقائية (user.created, account.suspended...) تصمت بدون خطأ
    EventEmitterModule.forRoot({
      wildcard: false,
      ignoreErrors: false, // أخطاء الـ listeners تظهر في logs
    }),

    // ✅ Rate limiting: 60 طلب/دقيقة على كل endpoints الأدمن
    // Login و Refresh لهما throttle خاص بهما (@Throttle decorator)
    ThrottlerModule.forRoot([{
      name: 'admin',
      ttl: 60000,   // نافذة 1 دقيقة
      limit: 60,    // 60 طلب/دقيقة/IP
    }]),

    // ✅ BullMQ queue للإشعارات (WhatsApp + Email)
    BullModule.registerQueue({
      name: 'notifications',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),

    // ✅ NEW: BillingModule — يوفر SubscriptionManagementService
    BillingModule,

    // ✅ NEW: InboxModule — يوفر InboxService لصندوق رسائل الأدمن
    InboxModule,

    // ✅ NEW: OtpRelayModule — يوفر TelegramOtpClientService لإعدادات Telegram
    OtpRelayModule,
    PlatformCapabilitiesModule,
  ],

  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminStoresController,
    WhatsappController,
    TemplatesController,
    AuditLogsController,
    SystemHealthController,
    // ✅ NEW: إدارة اشتراكات التجار
    AdminSubscriptionsController,
    // ✅ NEW: صندوق رسائل الأدمن
    AdminInboxController,
    // ✅ NEW: نظام الصيانة الجزئي
    MaintenancePublicController,
    MaintenanceAdminController,
    // ✅ NEW: إعدادات Telegram OTP
    AdminTelegramController,
    // ✅ NEW: تنبيهات الإدارة العليا (WhatsApp alerts on platform events)
    AdminAlertsController,
    AdminPlatformFeaturesController,
  ],

  providers: [
    // Services
    AuditService,
    AdminUsersService,
    WhatsappSettingsService,
    NotificationService,
    MaintenanceService,

    // Guards
    AdminJwtGuard,
    AdminPermissionGuard,

    // BullMQ Processor
    NotificationProcessor,

    // Event Listeners
    NotificationEventListener,
    AdminAlertsListener,  // ✅ NEW
    AdminAlertsService,   // ✅ NEW
    AdminTwoFactorSecretService,
    AdminLoginProtectionService,
  ],

  // Exported for use in other modules (e.g., stores module, webhooks module)
  exports: [
    AuditService,
    NotificationService,
    WhatsappSettingsService,
    AdminAlertsService,   // ✅ NEW — لو نحتاجها خارج الـ module
    AdminTwoFactorSecretService,
    AdminLoginProtectionService,
  ],
})
export class AdminModule {}
