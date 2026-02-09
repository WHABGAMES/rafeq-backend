/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Employee Notifications Module                        ║
 * ║                                                                                ║
 * ║  تسجيل: Entities + Service + Controller + Processor + Listener                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Entities
import { NotificationRule } from './entities/notification-rule.entity';
import { EmployeeNotification } from './entities/employee-notification.entity';

// Service & Controller
import { EmployeeNotificationsService } from './employee-notifications.service';
import { EmployeeNotificationsController } from './employee-notifications.controller';

// Processor & Listener
import { NotificationProcessor } from './notification.processor';
import { NotificationEventListener } from './listeners/notification-event.listener';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationRule, EmployeeNotification]),

    BullModule.registerQueue({
      name: 'employee-notifications',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
  ],

  controllers: [EmployeeNotificationsController],

  providers: [
    EmployeeNotificationsService,
    NotificationProcessor,
    NotificationEventListener,
  ],

  exports: [EmployeeNotificationsService],
})
export class EmployeeNotificationsModule {}
