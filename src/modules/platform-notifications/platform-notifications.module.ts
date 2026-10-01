/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Platform Notifications Module                       ║
 * ║                                                                               ║
 * ║  Module مستقل يمكن استيراده في app.module.ts مباشرة                          ║
 * ║  يتجنب circular dependency مع AdminModule بعدم import AdminModule             ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 *
 * ─── خطوات التسجيل ──────────────────────────────────────────────────────────────
 *
 * 1. src/config/typeorm.config.ts — أضف entity:
 *    import { PlatformNotification } from '../modules/platform-notifications/platform-notification.entity';
 *    const entities = [..., PlatformNotification];
 *
 * 2. src/app.module.ts — أضف module:
 *    import { PlatformNotificationsModule } from '@modules/platform-notifications/platform-notifications.module';
 *    imports: [..., PlatformNotificationsModule]
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';

import { PlatformNotification } from './platform-notification.entity';
import { PlatformNotificationUserAction } from './platform-notification-user-action.entity';
import { PlatformNotificationsService } from './platform-notifications.service';
import { AdminPlatformNotificationsController } from './admin-platform-notifications.controller';
import { PlatformNotificationsPublicController } from './platform-notifications-public.controller';

// ✅ AdminJwtGuard يحتاج: JwtService + AdminUser repository
// نُوفّرهما هنا بدلاً من استيراد AdminModule لتجنب circular dependency
import { AdminUser } from '@modules/admin/entities/admin-user.entity';
import { AdminJwtGuard, AdminPermissionGuard } from '@modules/admin/guards/admin.guards';
import { getAdminJwtSecret } from '@modules/admin/admin-jwt-secret';

@Module({
  imports: [
    // ✅ PlatformNotification + AdminUser (لـ AdminJwtGuard)
    TypeOrmModule.forFeature([PlatformNotification, PlatformNotificationUserAction, AdminUser]),

    // ✅ JwtModule لـ AdminJwtGuard.jwtService
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getAdminJwtSecret(),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  providers: [
    PlatformNotificationsService,
    // ✅ Guards مسجَّلة هنا كـ providers حتى تعمل في هذا الـ module
    AdminJwtGuard,
    AdminPermissionGuard,
  ],
  controllers: [
    AdminPlatformNotificationsController,
    PlatformNotificationsPublicController,
  ],
  exports: [PlatformNotificationsService],
})
export class PlatformNotificationsModule {}
