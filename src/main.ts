import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ✅ IMPORTANT: Use PORT from environment (DigitalOcean sets this)
  const port = process.env.PORT || 3000;
  
  // ✅ Enable CORS for frontend
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://rafeq-rafeq-frontend-s6zef.ondigitalocean.app',
      'https://sea-turtle-app-neix4.ondigitalocean.app',
      /\.ondigitalocean\.app$/,
      /\.vercel\.app$/,
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  
  // ✅ Global API prefix
  app.setGlobalPrefix('api');
  
  // ✅ Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  
  // ✅ Swagger API Docs
  const config = new DocumentBuilder()
    .setTitle('RAFEQ API')
    .setDescription('RAFEQ Platform API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  
  // ✅ CRITICAL: Listen on 0.0.0.0 (not localhost) for DigitalOcean
  await app.listen(port, '0.0.0.0');
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 Rafiq Platform is running!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Port: ${port}`);
  console.log(`📚 API Docs: /api/docs`);
  console.log(`❤️ Health: /api/health`);
  console.log('═══════════════════════════════════════════════════════════');
}

bootstrap();
