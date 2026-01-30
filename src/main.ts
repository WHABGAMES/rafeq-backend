import 'module-alias/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  const port = parseInt(process.env.PORT || '3000', 10);
  
  // ✅ Trust proxy for DigitalOcean App Platform (required for CORS to work properly)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);
  
  // ✅ CORS - Allow ALL origins with ALL methods and headers
  app.enableCors({
    origin: true,  // Allow all origins
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'Accept', 
      'Origin', 
      'X-Requested-With',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods',
    ],
    exposedHeaders: ['Authorization'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  
  // Global API prefix
  app.setGlobalPrefix('api');
  
  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  
  // Swagger
  const config = new DocumentBuilder()
    .setTitle('RAFEQ API')
    .setDescription('RAFEQ Platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  
  // Listen on 0.0.0.0
  await app.listen(port, '0.0.0.0');
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 Rafiq Platform is running!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 URL: http://0.0.0.0:${port}`);
  console.log(`📚 API Docs: /api/docs`);
  console.log(`❤️ Health: /api/health`);
  console.log('═══════════════════════════════════════════════════════════');
}

bootstrap();
