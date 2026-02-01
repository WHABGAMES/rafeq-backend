/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - TypeORM Configuration                      ║
 * ║                                                                                ║
 * ║  ✅ تم تصحيح مسار Store Entity                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

// ═══════════════════════════════════════════════════════════════════════════════
// استيراد جميع الـ Entities
// ═══════════════════════════════════════════════════════════════════════════════
import { User } from '@database/entities/user.entity';
import { Tenant } from '@database/entities/tenant.entity';
// ✅ تم تصحيح المسار - يشير مباشرة للـ Store entity الجديد
import { Store } from '@modules/stores/entities/store.entity';
import { Channel } from '@database/entities/channel.entity';
import { Message } from '@database/entities/message.entity';
import { Conversation } from '@database/entities/conversation.entity';
import { Campaign } from '@database/entities/campaign.entity';
import { Customer } from '@database/entities/customer.entity';
import { Order } from '@database/entities/order.entity';
import { WebhookEvent } from '@database/entities/webhook-event.entity';
import { MessageTemplate } from '@database/entities/message-template.entity';
import { Subscription } from '@database/entities/subscription.entity';
import { SubscriptionPlan } from '@database/entities/subscription-plan.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// قائمة جميع الـ Entities
// ═══════════════════════════════════════════════════════════════════════════════
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
  MessageTemplate,
  Subscription,
  SubscriptionPlan,
];

// ═══════════════════════════════════════════════════════════════════════════════
// دالة بناء إعدادات TypeORM
// ═══════════════════════════════════════════════════════════════════════════════
export const buildTypeOrmConfig = (
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
    
    // ✅ SSL مُفعّل تلقائياً في Production لـ DigitalOcean
    ssl: isProduction || configService.get<boolean>('database.ssl', false)
      ? {
          rejectUnauthorized: false,
        }
      : false,

    entities: entities,

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔄 المزامنة التلقائية
    // ═══════════════════════════════════════════════════════════════════════════
    synchronize: configService.get<boolean>('database.synchronize', false),

    // ═══════════════════════════════════════════════════════════════════════════
    // 📝 التسجيل (Logging)
    // ═══════════════════════════════════════════════════════════════════════════
    logging: isDevelopment
      ? ['error', 'warn', 'migration']
      : configService.get<boolean>('database.logging', false)
        ? ['error', 'warn', 'migration']
        : ['error'],

    // ═══════════════════════════════════════════════════════════════════════════
    // 🏊 Connection Pool
    // ═══════════════════════════════════════════════════════════════════════════
    extra: {
      max: isProduction ? 20 : 5,
      min: isProduction ? 5 : 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔄 Retry Configuration
    // ═══════════════════════════════════════════════════════════════════════════
    retryAttempts: isDevelopment ? 10 : 3,
    retryDelay: 3000,
    keepConnectionAlive: isDevelopment,

    // ═══════════════════════════════════════════════════════════════════════════
    // 📁 Migrations
    // ═══════════════════════════════════════════════════════════════════════════
    migrations: ['dist/database/migrations/*.js'],
    migrationsTableName: 'migrations_history',
    schema: 'public',
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// TypeORM Async Configuration for NestJS
// ═══════════════════════════════════════════════════════════════════════════════
export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
    return buildTypeOrmConfig(configService);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// DataSource Configuration for CLI
// ═══════════════════════════════════════════════════════════════════════════════
import * as dotenv from 'dotenv';
dotenv.config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'rafiq_db',
  username: process.env.DB_USERNAME || 'rafiq_user',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: entities,
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
};

export const AppDataSource = new DataSource(dataSourceOptions);
