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
