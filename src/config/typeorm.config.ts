/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - TypeORM Configuration                          ║
 * ║                                                                                ║
 * ║  🔧 SECURITY FIXES:                                                            ║
 * ║  C-01: DB_SYNCHRONIZE → ALWAYS false in production (hardcoded safeguard)       ║
 * ║  M-01: SSL rejectUnauthorized → true with CA cert support                      ║
 * ║  L-03: Connection pool → increased to 50 with proper tuning                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions, TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';

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
import { Store } from '../modules/stores/entities/store.entity';
import { Automation } from '../modules/automations/entities/automation.entity';
import { StoreSettings } from '../modules/settings/entities/store-settings.entity';
import { NotificationRule } from '../modules/employee-notifications/entities/notification-rule.entity';
import { EmployeeNotification } from '../modules/employee-notifications/entities/employee-notification.entity';
import { KnowledgeBase } from '../modules/ai/entities/knowledge-base.entity';

const entities = [
  User, Tenant, Store, Channel, Message, Conversation, Campaign, Customer,
  Order, WebhookEvent, WebhookLog, MessageTemplate, Subscription, SubscriptionPlan,
  Automation, StoreSettings, ScheduledTemplateSend, NotificationRule,
  EmployeeNotification, KnowledgeBase,
];

/**
 * 🔧 FIX M-01: Load CA certificate for SSL verification
 * Only from explicit user config — NOT system defaults (system CA doesn't include DO's DB CA)
 */
function loadCACertificate(configService: ConfigService): Buffer | undefined {
  // Priority 1: Base64-encoded CA cert in environment variable
  const caCertBase64 = configService.get<string>('DB_CA_CERT');
  if (caCertBase64) return Buffer.from(caCertBase64, 'base64');

  // Priority 2: File path to CA cert
  const caCertPath = configService.get<string>('DB_CA_CERT_PATH');
  if (caCertPath) {
    try { return fs.readFileSync(path.resolve(caCertPath)); }
    catch { console.error(`⚠️ Failed to read CA certificate from ${caCertPath}`); }
  }

  // No explicit CA provided — return undefined
  // DO NOT fallback to system CA bundle (/etc/ssl/certs/ca-certificates.crt)
  // because it does not contain DigitalOcean Managed Database CA certificates
  return undefined;
}

const buildConfig = (configService: ConfigService): TypeOrmModuleOptions => {
  const nodeEnv = configService.get<string>('app.env', 'development');
  const isProduction = nodeEnv === 'production';
  const isDevelopment = nodeEnv === 'development';

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 FIX C-01: HARDCODED SAFEGUARD — synchronize is ALWAYS false in production
  // ═══════════════════════════════════════════════════════════════════════════
  const synchronize = isProduction ? false : configService.get<boolean>('database.synchronize', false);

  if (isProduction && configService.get<string>('DB_SYNCHRONIZE') === 'true') {
    console.error('🚨 SECURITY: DB_SYNCHRONIZE=true is IGNORED in production. Use TypeORM migrations.');
  }

  // 🔧 FIX M-01: SSL with CA certificate verification when explicitly provided
  // Default: rejectUnauthorized=false (required for DigitalOcean Managed Database self-signed certs)
  // Upgraded: rejectUnauthorized=true when DB_CA_CERT or DB_CA_CERT_PATH is configured
  let sslConfig: boolean | Record<string, unknown> = false;
  if (isProduction || configService.get<boolean>('database.ssl', false)) {
    const ca = loadCACertificate(configService);
    if (ca) {
      // Explicit CA provided → full verification
      sslConfig = { rejectUnauthorized: true, ca };
      console.log('✅ SSL: Using provided CA certificate with full verification');
    } else {
      // No explicit CA → accept self-signed (DigitalOcean default)
      sslConfig = { rejectUnauthorized: false };
      if (isProduction) {
        console.warn('⚠️ SSL: rejectUnauthorized=false. Set DB_CA_CERT for full certificate verification.');
      }
    }
  }

  return {
    type: 'postgres',
    host: configService.get<string>('database.host', 'localhost'),
    port: configService.get<number>('database.port', 5432),
    database: configService.get<string>('database.name', 'rafiq_db'),
    username: configService.get<string>('database.username', 'rafiq_user'),
    password: configService.get<string>('database.password', ''),
    ssl: sslConfig,
    entities,
    synchronize,
    logging: isDevelopment
      ? ['error', 'warn', 'migration']
      : configService.get<boolean>('database.logging', false)
        ? ['error', 'warn', 'migration']
        : ['error'],
    // 🔧 FIX L-03: Increased connection pool
    extra: {
      max: isProduction ? parseInt(configService.get('DB_POOL_MAX', '50'), 10) : 5,
      min: isProduction ? parseInt(configService.get('DB_POOL_MIN', '10'), 10) : 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: isProduction ? 5000 : 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      statement_timeout: isProduction ? 30000 : 60000,
    },
    retryAttempts: isProduction ? 10 : 3,
    retryDelay: 3000,
    autoLoadEntities: false,
    keepConnectionAlive: false,
  };
};

export const typeOrmConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  useFactory: buildConfig,
  inject: [ConfigService],
};

export const buildTypeOrmConfig = typeOrmConfig;
export const databaseConfig = typeOrmConfig;
export default typeOrmConfig;
