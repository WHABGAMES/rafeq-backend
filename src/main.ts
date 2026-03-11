/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Main Entry Point                           ║
 * ║                                                                                ║
 * ║  ✅ v6: FIX WH-01 — Webhook rawBody Preservation                              ║
 * ║                                                                                ║
 * ║  المشكلة: double body-parser registration                                      ║
 * ║    NestFactory.create({ rawBody: true, bodyParser: true })                    ║
 * ║    ثم: app.useBodyParser('json', { limit: '1mb' })                            ║
 * ║    → الـ useBodyParser الثاني يُعيد تسجيل parser جديد بدون verify callback   ║
 * ║    → req.rawBody يأتي فارغاً أو خاطئاً عند التحقق من توقيع Webhooks          ║
 * ║                                                                                ║
 * ║  الحل:                                                                         ║
 * ║    bodyParser: false — تعطيل التسجيل التلقائي                                ║
 * ║    + useBodyParser('json', { limit }) مرة واحدة فقط                          ║
 * ║    NestJS يُضيف verify callback تلقائياً لحفظ rawBody عند rawBody:true        ║
 * ║                                                                                ║
 * ║  🔧 FIX C2: CORS whitelist                                                    ║
 * ║  🔧 FIX H1: Swagger محمي في الإنتاج                                           ║
 * ║  🔧 FIX M5: Helmet security headers                                           ║
 * ║  🔧 FIX M-01: CSRF protection                                                 ║
 * ║  🔧 FIX L3: Graceful shutdown                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import 'module-alias/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { csrfCookieMiddleware } from './common/guards/csrf.guard';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('═══════════════════════════════════════════════════════════════');
  logger.log('🚀 Starting Rafiq Platform...');
  logger.log(`📅 Time: ${new Date().toISOString()}`);
  logger.log(`🌍 NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  logger.log(`🔌 PORT: ${process.env.PORT || '3000'}`);
  logger.log('═══════════════════════════════════════════════════════════════');

  const requiredVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'JWT_SECRET'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    logger.warn(`⚠️ Missing env vars: ${missingVars.join(', ')}`);
  }

  try {
    // ─── FIX WH-01: rawBody preservation ──────────────────────────────────────
    // rawBody: true  → NestJS يُفعّل آلية حفظ rawBody (verify callback)
    // bodyParser: false → نمنع التسجيل التلقائي المزدوج
    // ثم نستدعي useBodyParser مرة واحدة يدوياً مع حد الحجم المطلوب
    // NestJS سيُضيف verify callback تلقائياً لأن rawBody:true مُفعّل
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
      rawBody: true,        // ✅ يُفعّل حفظ rawBody
      bodyParser: false,    // ✅ FIX WH-01: نمنع double-parsing
    });

    // تسجيل واحد فقط — NestJS يُضيف rawBody verify callback تلقائياً
    app.useBodyParser('json', { limit: '1mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

    logger.log('✅ Body parser configured with rawBody preservation (FIX WH-01)');

    const configService = app.get(ConfigService);
    const port = parseInt(process.env.PORT || '3000', 10);
    const isProduction = process.env.NODE_ENV === 'production';

    // ─── Helmet Security Headers ───────────────────────────────────────────────
    app.use(helmet({
      contentSecurityPolicy: isProduction ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: [
            "'self'",
            'https://api.rafeq.ai',
            'https://accounts.salla.sa',
            'https://api.salla.dev',
            'https://api.zid.sa',
            'wss://*.rafeq.ai',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      } : false,
      crossOriginEmbedderPolicy: false,
      hsts: isProduction ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      } : false,
    }));
    logger.log('✅ Helmet security headers enabled');

    // Trust Proxy (Required for DigitalOcean / Cloudflare)
    app.set('trust proxy', 1);

    // ─── CSRF Protection ───────────────────────────────────────────────────────
    app.use(cookieParser());
    app.use(csrfCookieMiddleware(configService));
    logger.log('✅ CSRF protection enabled');

    // ─── CORS ─────────────────────────────────────────────────────────────────
    const corsOrigins: string[] = configService.get<string[]>('security.corsOrigins') || [
      'https://rafeq.ai',
      'https://www.rafeq.ai',
    ];

    if (!isProduction) {
      corsOrigins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
      );
    }

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin) { callback(null, true); return; }
        if (corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn(`🚫 CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type', 'Authorization', 'Accept', 'Origin',
        'X-Requested-With', 'Cache-Control', 'Pragma',
        'If-Modified-Since', 'X-CSRF-Token', 'x-store-id',
      ],
      exposedHeaders: ['Content-Length', 'Content-Type'],
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204,
      maxAge: 86400,
    });
    logger.log(`✅ CORS configured for: ${corsOrigins.join(', ')}`);

    // ─── Global Prefix & Validation ───────────────────────────────────────────
    app.setGlobalPrefix('api');

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }));

    // ─── Swagger (dev only) ───────────────────────────────────────────────────
    if (!isProduction) {
      const config = new DocumentBuilder()
        .setTitle('RAFEQ API')
        .setDescription('RAFEQ Platform API - Development Only')
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT-auth')
        .build();
      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document);
      logger.log('✅ Swagger ready at /api/docs (DEV ONLY)');
    } else {
      logger.log('🔒 Swagger disabled in production');
    }

    // ─── Auto-create subscription tables (safe — IF NOT EXISTS) ─────────────
    try {
      const ds = app.get(DataSource);

      // ─── Add missing columns to tenants table ───────────────────────────────
      await ds.query(`DO $$ BEGIN CREATE TYPE tenants_subscription_plan_enum AS ENUM ('free','basic','pro','enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await ds.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_plan tenants_subscription_plan_enum NOT NULL DEFAULT 'free'`);
      await ds.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ`);
      await ds.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`);
      await ds.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS monthly_message_limit INTEGER NOT NULL DEFAULT 0`);

      // ─── Create subscription enums + tables ─────────────────────────────────
      await ds.query(`DO $$ BEGIN CREATE TYPE plan_type_enum AS ENUM ('free','paid','trial','custom'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await ds.query(`DO $$ BEGIN CREATE TYPE plan_status_enum AS ENUM ('active','inactive','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await ds.query(`DO $$ BEGIN CREATE TYPE subscription_status_enum AS ENUM ('trialing','active','past_due','suspended','cancelling','cancelled','expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await ds.query(`DO $$ BEGIN CREATE TYPE billing_interval_enum AS ENUM ('monthly','quarterly','semi_annual','yearly'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await ds.query(`DO $$ BEGIN CREATE TYPE payment_provider_enum AS ENUM ('stripe','moyasar','bank_transfer','manual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await ds.query(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL, slug VARCHAR(50) NOT NULL, description TEXT,
          type plan_type_enum NOT NULL DEFAULT 'paid', status plan_status_enum NOT NULL DEFAULT 'active',
          pricing JSONB NOT NULL DEFAULT '{}', features JSONB NOT NULL DEFAULT '{}',
          feature_list JSONB NOT NULL DEFAULT '[]', trial_days INTEGER NOT NULL DEFAULT 0,
          metadata JSONB DEFAULT '{}', display_order INTEGER NOT NULL DEFAULT 0,
          is_visible BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
        )
      `);
      await ds.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_slug ON subscription_plans (slug)`);
      await ds.query(`CREATE INDEX IF NOT EXISTS idx_subscription_plans_type_status ON subscription_plans (type, status)`);
      await ds.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL, plan_id UUID NOT NULL,
          status subscription_status_enum NOT NULL DEFAULT 'trialing',
          billing_interval billing_interval_enum NOT NULL DEFAULT 'monthly',
          started_at TIMESTAMPTZ, trial_ends_at TIMESTAMPTZ,
          current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
          currency VARCHAR(5) NOT NULL DEFAULT 'SAR',
          amount DECIMAL(12,2) NOT NULL DEFAULT 0, discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0, tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          payment_provider payment_provider_enum, payment_methods JSONB NOT NULL DEFAULT '[]',
          usage_stats JSONB NOT NULL DEFAULT '{"messagesUsed":0,"messagesLimit":0,"storesCount":0,"storesLimit":0,"usersCount":0,"usersLimit":0,"storageUsed":0,"storageLimit":0,"lastUpdated":null}',
          billing_info JSONB, auto_renew BOOLEAN NOT NULL DEFAULT true, metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
          CONSTRAINT fk_subscription_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          CONSTRAINT fk_subscription_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT
        )
      `);
      await ds.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON subscriptions (tenant_id, status)`);
      await ds.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_period ON subscriptions (tenant_id, current_period_end)`);
      await ds.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status)`);
      await ds.query(`
        INSERT INTO subscription_plans (name, slug, type, status, pricing, features, feature_list, display_order, is_visible)
        VALUES
          ('أساسي','basic','paid','active','{"currency":"SAR","monthlyPrice":49,"yearlyPrice":468,"yearlyDiscount":20}','{"monthlyMessages":1000,"maxStores":3,"maxUsers":3,"maxWhatsAppChannels":2,"maxInstagramChannels":1,"maxDiscordChannels":1,"maxActiveCampaigns":10,"maxTemplates":20,"storageLimit":1000,"aiSupport":false,"advancedAnalytics":false,"apiAccess":false}','["1,000 رسالة/شهر","إشعارات الطلبات","قوالب جاهزة"]',1,true),
          ('احترافي','professional','paid','active','{"currency":"SAR","monthlyPrice":69,"yearlyPrice":660,"yearlyDiscount":20}','{"monthlyMessages":10000,"maxStores":10,"maxUsers":10,"maxWhatsAppChannels":5,"maxInstagramChannels":3,"maxDiscordChannels":2,"maxActiveCampaigns":50,"maxTemplates":100,"storageLimit":5000,"aiSupport":true,"advancedAnalytics":true,"apiAccess":true}','["10,000 رسالة/شهر","بوت الذكاء الاصطناعي","تحليلات متقدمة"]',2,true)
        ON CONFLICT (slug) DO NOTHING
      `);
      logger.log('✅ Subscription tables ready');
    } catch (e: any) {
      logger.error(`❌ SUBSCRIPTION TABLES FAILED: ${e.message}`);
      logger.error(e.stack);
    }

    // ─── Start ────────────────────────────────────────────────────────────────
    await app.listen(port, '0.0.0.0');

    logger.log('═══════════════════════════════════════════════════════════════');
    logger.log('🎉 RAFIQ PLATFORM STARTED SUCCESSFULLY!');
    logger.log(`🔗 API: http://0.0.0.0:${port}/api`);
    if (!isProduction) logger.log(`📚 Swagger: http://0.0.0.0:${port}/api/docs`);
    logger.log(`🏥 Health: http://0.0.0.0:${port}/api/health`);
    logger.log('═══════════════════════════════════════════════════════════════');

    // ─── Graceful Shutdown ────────────────────────────────────────────────────
    const gracefulShutdown = async (signal: string) => {
      logger.warn(`⚠️ ${signal} received — shutting down gracefully...`);
      try {
        await app.close();
        logger.log('✅ Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error('❌ Shutdown error', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ FAILED TO START!');
    if (error instanceof Error) {
      logger.error(`Error: ${error.message}`);
      if (error.message.includes('ECONNREFUSED')) {
        logger.error('🔴 CONNECTION REFUSED — Check DB/Redis');
      }
    }
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
  setTimeout(() => process.exit(1), 3000);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('❌ Unhandled Rejection:', reason?.message || reason);
  setTimeout(() => process.exit(1), 3000);
});

bootstrap();
