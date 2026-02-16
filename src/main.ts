/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Main Entry Point                           ║
 * ║                                                                                ║
 * ║  ✅ v5: Security Fixes                                                         ║
 * ║  🔧 FIX C2: CORS whitelist بدل origin: true                                   ║
 * ║  🔧 FIX H1: Swagger محمي في الإنتاج                                           ║
 * ║  🔧 FIX M5: Helmet security headers                                           ║
 * ║  🔧 FIX L3: Graceful shutdown بدل process.exit مباشرة                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import 'module-alias/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet'; // 🔧 FIX M5
import cookieParser from 'cookie-parser'; // 🔧 FIX M-01
import { csrfCookieMiddleware } from './common/guards/csrf.guard'; // 🔧 FIX M-01

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  logger.log('═══════════════════════════════════════════════════════════════');
  logger.log('🚀 Starting Rafiq Platform...');
  logger.log(`📅 Time: ${new Date().toISOString()}`);
  logger.log(`🌍 NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  logger.log(`🔌 PORT: ${process.env.PORT || '3000'}`);
  logger.log('═══════════════════════════════════════════════════════════════');

  // ═══════════════════════════════════════════════════════════════════════════
  // Validate critical environment variables
  // ═══════════════════════════════════════════════════════════════════════════
  const requiredVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'JWT_SECRET'];
  const missingVars = requiredVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    logger.warn(`⚠️ Missing env vars: ${missingVars.join(', ')}`);
  }

  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
      rawBody: true,
      // 🔧 FIX M-07: Global body size limit — prevents OOM from oversized payloads
      bodyParser: true,
    });

    // 🔧 FIX M-07: Set body size limits via Express directly
    // Must be BEFORE any route handlers
    app.useBodyParser('json', { limit: '1mb' });
    app.useBodyParser('raw', { limit: '1mb' });

    const configService = app.get(ConfigService);
    const port = parseInt(process.env.PORT || '3000', 10);
    const isProduction = process.env.NODE_ENV === 'production';

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX M5: Helmet Security Headers
    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX M-02: HSTS header for HTTPS enforcement
    // 🔧 FIX M-03: Proper CSP in production
    app.use(helmet({
      // 🔧 FIX M-03: Content Security Policy — enabled in production
      contentSecurityPolicy: isProduction ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],  // Needed for some UI libraries
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: [
            "'self'",
            'https://api.rafeq.ai',
            'https://accounts.salla.sa',
            'https://api.salla.dev',
            'https://api.zid.sa',
            'wss://*.rafeq.ai',  // WebSocket connections
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      } : false,  // Disabled in development for Swagger
      crossOriginEmbedderPolicy: false,
      // 🔧 FIX M-02: HSTS — enforce HTTPS for 1 year with preload
      hsts: isProduction ? {
        maxAge: 31536000,         // 1 year
        includeSubDomains: true,
        preload: true,
      } : false,
    }));
    logger.log('✅ Helmet security headers enabled (HSTS + CSP)');

    // Trust Proxy (Required for DigitalOcean)
    app.set('trust proxy', 1);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX M-01: CSRF Protection via Double Submit Cookie
    // ═══════════════════════════════════════════════════════════════════════════
    app.use(cookieParser());
    app.use(csrfCookieMiddleware(configService));
    logger.log('✅ CSRF protection enabled (Double Submit Cookie)');

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX C2: CORS - استخدام whitelist من الإعدادات بدل origin: true
    // ═══════════════════════════════════════════════════════════════════════════
    const corsOrigins: string[] = configService.get<string[]>('security.corsOrigins') || [
      'https://rafeq.ai',
      'https://www.rafeq.ai',
    ];

    // في بيئة التطوير: نضيف localhost
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
        // السماح للطلبات بدون origin (مثل mobile apps, curl, server-to-server)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn(`🚫 CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'X-Requested-With',
        'Cache-Control',
        'Pragma',
        'If-Modified-Since',
        'X-CSRF-Token',
        'x-store-id', // ✅ added
      ],
      exposedHeaders: ['Content-Length', 'Content-Type'],
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204,
      maxAge: 86400,
    });
    logger.log(`✅ CORS configured for: ${corsOrigins.join(', ')}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // Global Prefix & Validation
    // ═══════════════════════════════════════════════════════════════════════════
    app.setGlobalPrefix('api');

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }));

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX H1: Swagger - تعطيل في الإنتاج أو حماية بـ Basic Auth
    // ═══════════════════════════════════════════════════════════════════════════
    if (!isProduction) {
      const config = new DocumentBuilder()
        .setTitle('RAFEQ API')
        .setDescription('RAFEQ Platform API - Development Only')
        .setVersion('1.0')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'JWT-auth',
        )
        .build();

      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document);
      logger.log('✅ Swagger documentation ready at /api/docs (DEV ONLY)');
    } else {
      logger.log('🔒 Swagger documentation disabled in production');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Start Server
    // ═════════════════════════════════════════════════════════════════════���═════
    await app.listen(port, '0.0.0.0');

    logger.log('═══════════════════════════════════════════════════════════════');
    logger.log('🎉 RAFIQ PLATFORM STARTED SUCCESSFULLY!');
    logger.log(`🔗 API URL: http://0.0.0.0:${port}/api`);
    if (!isProduction) {
      logger.log(`📚 Swagger: http://0.0.0.0:${port}/api/docs`);
    }
    logger.log(`🏥 Health:  http://0.0.0.0:${port}/api/health`);
    logger.log('═══════════════════════════════════════════════════════════════');

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔧 FIX L3: Graceful Shutdown
    // ═══════════════════════════════════════════════════════════════════════════
    const gracefulShutdown = async (signal: string) => {
      logger.warn(`⚠️ Received ${signal}. Starting graceful shutdown...`);
      try {
        await app.close(); // يطلق OnModuleDestroy hooks
        logger.log('✅ Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error('❌ Error during shutdown', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ FAILED TO START RAFIQ PLATFORM!');

    if (error instanceof Error) {
      logger.error(`Error: ${error.message}`);
      if (error.message.includes('ECONNREFUSED')) {
        logger.error('🔴 CONNECTION REFUSED - Check database/redis connection');
      }
    }

    process.exit(1);
  }
}

// 🔧 FIX L3: Global error handlers مع graceful shutdown
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
  // لا نعمل exit فوري - نعطي فرصة لإغلاق الاتصالات
  setTimeout(() => process.exit(1), 3000);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('❌ Unhandled Rejection:', reason?.message || reason);
  // لا نعمل exit فوري
  setTimeout(() => process.exit(1), 3000);
});

bootstrap();
