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
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

// Entities
import { AdminUser } from './entities/admin-user.entity';
import { AuditLog } from './entities/audit-log.entity';
import { MergeHistory } from './entities/merge-history.entity';
import { WhatsappSettings } from './entities/whatsapp-settings.entity';
import { MessageTemplate } from './entities/message-template.entity';
import { MessageLog } from './entities/message-log.entity';

// Services
import { AuditService } from './services/audit.service';
import { AdminUsersService } from './services/admin-users.service';
import { WhatsappSettingsService } from './services/whatsapp-settings.service';
import { NotificationService } from './services/notification.service';

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

// Guards
import { AdminJwtGuard, AdminPermissionGuard } from './guards/admin.guards';

// Processor & Listeners
import { NotificationProcessor } from './processors/notification.processor';
import { NotificationEventListener } from './listeners/notification-event.listener';

// ─── [C-2] Startup Validation ─────────────────────────────────────────────────
// يُنفَّذ قبل أي شيء عند تحميل الـ module
const jwtSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

if (!jwtSecret) {
  // في production: throw → التطبيق لا يبدأ إطلاقًا
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '\n\n' +
      '╔══════════════════════════════════════════════════════════╗\n' +
      '║  FATAL: Admin JWT Secret is not configured!              ║\n' +
      '║                                                          ║\n' +
      '║  Set one of these env vars before starting:              ║\n' +
      '║    ADMIN_JWT_SECRET=<strong-random-64-chars>             ║\n' +
      '║    JWT_SECRET=<strong-random-64-chars>                   ║\n' +
      '║                                                          ║\n' +
      '║  Without this, any attacker can forge admin tokens!      ║\n' +
      '╚══════════════════════════════════════════════════════════╝\n',
    );
  }
  // في development: تحذير فقط
  console.warn('\n⚠️  WARNING: ADMIN_JWT_SECRET / JWT_SECRET not set — using insecure fallback for development only!\n');
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminUser,
      AuditLog,
      MergeHistory,
      WhatsappSettings,
      MessageTemplate,
      MessageLog,
    ]),

    // ✅ JwtModule يستخدم نفس الـ secret المُتحقَّق منه أعلاه
    JwtModule.register({
      secret: jwtSecret || 'rafeq-dev-insecure-fallback',
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
  ],

  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminStoresController,
    WhatsappController,
    TemplatesController,
    AuditLogsController,
    SystemHealthController,
  ],

  providers: [
    // Services
    AuditService,
    AdminUsersService,
    WhatsappSettingsService,
    NotificationService,

    // Guards
    AdminJwtGuard,
    AdminPermissionGuard,

    // ✅ ThrottlerGuard يطبَّق globally على كل routes في الـ app
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // BullMQ Processor
    NotificationProcessor,

    // Event Listeners
    NotificationEventListener,
  ],

  // Exported for use in other modules (e.g., stores module, webhooks module)
  exports: [
    AuditService,
    NotificationService,
    WhatsappSettingsService,
  ],
})
export class AdminModule {}
