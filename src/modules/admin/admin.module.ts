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

    JwtModule.register({
      secret: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
      signOptions: { expiresIn: '8h' },
    }),

    // ✅ Required for @Cron() in NotificationEventListener
    ScheduleModule.forRoot(),

    // ✅ Required for @OnEvent() in NotificationEventListener
    // Without this, all event-driven notifications (user.created, account.suspended, etc.) silently fail
    EventEmitterModule.forRoot({
      // Wildcard support: emit('user.*') matches @OnEvent('user.created')
      wildcard: false,
      // Prevent unhandled errors from crashing the process
      ignoreErrors: false,
    }),

    // ✅ Rate limiting: 10 requests per minute on all admin endpoints
    ThrottlerModule.forRoot([{
      name: 'admin',
      ttl: 60000,   // 1 minute window
      limit: 60,    // max 60 requests per minute per IP
    }]),

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

    // ✅ Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Processor
    NotificationProcessor,

    // Listeners
    NotificationEventListener,
  ],

  exports: [
    AuditService,
    NotificationService,
    WhatsappSettingsService,
  ],
})
export class AdminModule {}
