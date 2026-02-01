/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Main Entry Point                           ║
 * ║                                                                                ║
 * ║  ✅ CORS Fixed (including cache-control)                                       ║
 * ║  ✅ Detailed error logging                                                     ║
 * ║  ✅ Environment validation                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import 'module-alias/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // Log startup info
  // ═══════════════════════════════════════════════════════════════════════════════
  logger.log('═══════════════════════════════════════════════════════════════');
  logger.log('🚀 Starting Rafiq Platform...');
  logger.log(`📅 Time: ${new Date().toISOString()}`);
  logger.log(`🌍 NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  logger.log(`🔌 PORT: ${process.env.PORT || '3000'}`);
  logger.log('═══════════════════════════════════════════════════════════════');
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // Validate critical environment variables
  // ═══════════════════════════════════════════════════════════════════════════════
  logger.log('🔍 Checking environment variables...');
  
  const requiredVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USERNAME', 'JWT_SECRET'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  if (missingVars.length > 0) {
    logger.warn(`⚠️ Missing env vars: ${missingVars.join(', ')}`);
  } else {
    logger.log('✅ All required environment variables are set');
  }
  
  // Log connection info (without sensitive data)
  logger.log(`📦 DB_HOST: ${process.env.DB_HOST ? '✅ Set' : '❌ Not set'}`);
  logger.log(`📦 DB_PORT: ${process.env.DB_PORT || 'default (5432)'}`);
  logger.log(`📦 DB_NAME: ${process.env.DB_NAME || 'not set'}`);
  logger.log(`🔴 REDIS_HOST: ${process.env.REDIS_HOST ? '✅ Set' : '❌ Not set'}`);
  logger.log(`🔴 REDIS_PORT: ${process.env.REDIS_PORT || 'default (6379)'}`);
  logger.log(`🔴 REDIS_TLS: ${process.env.REDIS_TLS || 'false'}`);
  
  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // Create NestJS Application
    // ═══════════════════════════════════════════════════════════════════════════
    logger.log('📦 Creating NestJS application...');
    
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
      rawBody: true, // ✅ مطلوب للتحقق من توقيع Webhooks
    });
    
    logger.log('✅ NestJS application created successfully');
    
    const port = parseInt(process.env.PORT || '3000', 10);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Trust Proxy (Required for DigitalOcean)
    // ═══════════════════════════════════════════════════════════════════════════
    app.set('trust proxy', 1);
    logger.log('✅ Proxy trust enabled');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CORS Configuration - Allow ALL origins (✅ FIXED: Added Cache-Control)
    // ═══════════════════════════════════════════════════════════════════════════
    app.enableCors({
      origin: true, // Accept ALL origins
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept',
        'Origin',
        'X-Requested-With',
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Headers',
        'Cache-Control',        // ✅ Added - was causing CORS error
        'Pragma',               // ✅ Added
        'If-Modified-Since',    // ✅ Added
        'X-CSRF-Token',         // ✅ Added for CSRF
      ],
      exposedHeaders: ['Content-Length', 'Content-Type'],
      credentials: true,
      preflightContinue: false,
      optionsSuccessStatus: 204,
      maxAge: 86400,
    });
    logger.log('✅ CORS enabled for ALL origins (with Cache-Control)');

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
    logger.log('✅ Global prefix and validation configured');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Swagger Documentation
    // ═══════════════════════════════════════════════════════════════════════════
    const config = new DocumentBuilder()
      .setTitle('RAFEQ API')
      .setDescription('RAFEQ Platform API')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'JWT-auth',
      )
      .build();
    
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('✅ Swagger documentation ready at /api/docs');
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Start Server
    // ═══════════════════════════════════════════════════════════════════════════
    await app.listen(port, '0.0.0.0');
    
    logger.log('═══════════════════════════════════════════════════════════════');
    logger.log('🎉 RAFIQ PLATFORM STARTED SUCCESSFULLY!');
    logger.log('═══════════════════════════════════════════════════════════════');
    logger.log(`🔗 API URL: http://0.0.0.0:${port}/api`);
    logger.log(`📚 Swagger: http://0.0.0.0:${port}/api/docs`);
    logger.log(`🏥 Health:  http://0.0.0.0:${port}/api/health`);
    logger.log('═══════════════════════════════════════════════════════════════');
    
  } catch (error) {
    // ═══════════════════════════════════════════════════════════════════════════
    // Error Handling with detailed logs
    // ═══════════════════════════════════════════════════════════════════════════
    logger.error('═══════════════════════════════════════════════════════════════');
    logger.error('❌ FAILED TO START RAFIQ PLATFORM!');
    logger.error('═══════════════════════════════════════════════════════════════');
    
    if (error instanceof Error) {
      logger.error(`Error Type: ${error.constructor.name}`);
      logger.error(`Error Message: ${error.message}`);
      
      // Check for specific errors
      if (error.message.includes('ECONNREFUSED')) {
        logger.error('🔴 CONNECTION REFUSED - Check database/redis connection');
        logger.error(`   DB_HOST: ${process.env.DB_HOST}`);
        logger.error(`   REDIS_HOST: ${process.env.REDIS_HOST}`);
      }
      
      if (error.message.includes('password authentication failed')) {
        logger.error('🔴 DATABASE AUTH FAILED - Check DB_PASSWORD');
      }
      
      if (error.message.includes('does not exist')) {
        logger.error('🔴 DATABASE NOT FOUND - Check DB_NAME');
      }
      
      if (error.message.includes('SSL')) {
        logger.error('🔴 SSL ERROR - Check DB_SSL and REDIS_TLS settings');
      }
      
      // Log stack trace
      if (error.stack) {
        logger.error('Stack Trace:');
        error.stack.split('\n').slice(0, 10).forEach(line => {
          logger.error(`  ${line}`);
        });
      }
    } else {
      logger.error(`Unknown error: ${error}`);
    }
    
    logger.error('═══════════════════════════════════════════════════════════════');
    
    // Exit with error code
    process.exit(1);
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('❌ Unhandled Rejection:', reason?.message || reason);
  process.exit(1);
});

bootstrap();
