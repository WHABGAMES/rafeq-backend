/**
 * RAFIQ PLATFORM - TypeORM Configuration
 * src/config/typeorm.config.ts
 *
 * ✅ Fixed: exports TypeOrmModuleAsyncOptions for forRootAsync()
 * ✅ Fixed: Store entity relative import
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions, TypeOrmModuleOptions } from '@nestjs/typeorm';

// Entities from database
import { User } from '@database/entities/user.entity';
import { Tenant } from '@database/entities/tenant.entity';
import { Channel } from '@database/entities/channel.entity';
import { Message } from '@database/entities/message.entity';
import { Conversation } from '@database/entities/conversation.entity';
import { Campaign } from '@database/entities/campaign.entity';
import { Customer } from '@database/entities/customer.entity';
import { Order } from '@database/entities/order.entity';
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { WebhookLog } from '../modules/webhooks/entities/webhook-log.entity';
import { MessageTemplate } from '@database/entities/message-template.entity';
import { Subscription } from '@database/entities/subscription.entity';
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';
import { ScheduledTemplateSend } from '@database/entities/scheduled-template-send.entity';

// ✅ Store entity - relative import (not in @database/entities)
import { Store } from '../modules/stores/entities/store.entity';

// NEW: Entities from modules
import { Automation } from '../modules/automations/entities/automation.entity';
import { StoreSettings } from '../modules/settings/entities/store-settings.entity';

// 🔔 Employee Notifications
import { NotificationRule } from '../modules/employee-notifications/entities/notification-rule.entity';
import { EmployeeNotification } from '../modules/employee-notifications/entities/employee-notification.entity';

// 🤖 AI - Knowledge Base
import { KnowledgeBase } from '../modules/ai/entities/knowledge-base.entity';

// =============================================================================
// All Entities
// =============================================================================
const entities = [
  User,
  Tenant,
  Store,
  Channel,
  Message,
  Conversation,
  Campaign,
  Customer,
  Order,
  WebhookEvent,
  WebhookLog,
  MessageTemplate,
  Subscription,
  SubscriptionPlan,
  // NEW
  Automation,
  StoreSettings,
  ScheduledTemplateSend,  // ✅ v18: تسجيل entity الإرسال المجدول
  // 🔔 Employee Notifications
  NotificationRule,
  EmployeeNotification,
  // 🤖 AI
  KnowledgeBase,
];

// =============================================================================
// TypeORM Configuration Factory
// =============================================================================
const buildConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const nodeEnv = configService.get<string>('app.env', 'development');
  const isProduction = nodeEnv === 'production';
  const isDevelopment = nodeEnv === 'development';

  return {
    type: 'postgres',
    host: configService.get<string>('database.host', 'localhost'),
    port: configService.get<number>('database.port', 5432),
    database: configService.get<string>('database.name', 'rafiq_db'),
    username: configService.get<string>('database.username', 'rafiq_user'),
    password: configService.get<string>('database.password', ''),

    // SSL enabled automatically in Production for DigitalOcean
    ssl: isProduction || configService.get<boolean>('database.ssl', false)
      ? {
          rejectUnauthorized: false,
        }
      : false,

    entities: entities,

    // =======================================================================
    // Auto Synchronize
    // =======================================================================
    synchronize: configService.get<boolean>('database.synchronize', false),

    // =======================================================================
    // Logging
    // =======================================================================
    logging: isDevelopment
      ? ['error', 'warn', 'migration']
      : configService.get<boolean>('database.logging', false)
        ? ['error', 'warn', 'migration']
        : ['error'],

    // =======================================================================
    // Connection Pool
    // =======================================================================
    extra: {
      max: isProduction ? 20 : 5,
      min: isProduction ? 5 : 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: isProduction ? 5000 : 10000,
    },

    // =======================================================================
    // Retry Strategy
    // =======================================================================
    retryAttempts: isProduction ? 10 : 3,
    retryDelay: 3000,

    // =======================================================================
    // Auto Load Entities (disabled - using explicit list)
    // =======================================================================
    autoLoadEntities: false,

    // =======================================================================
    // Keep Alive
    // =======================================================================
    keepConnectionAlive: false,
  };
};

// =============================================================================
// ✅ Export as TypeOrmModuleAsyncOptions (for forRootAsync)
// This is what app.module.ts passes to TypeOrmModule.forRootAsync()
// =============================================================================
export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  useFactory: buildConfig,
  inject: [ConfigService],
};

// Aliases for backward compatibility
export const buildTypeOrmConfig = typeOrmConfig;
export const databaseConfig = typeOrmConfig;
export default typeOrmConfig;
