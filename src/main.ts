/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ملف main.ts - نقطة البداية للتطبيق
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * هذا هو أول ملف يُنفذ عند تشغيل التطبيق
 * مهمته: إنشاء التطبيق وإعداده وتشغيله
 *
 * 🔄 مسار التنفيذ:
 * ────────────────
 * 1. npm run start → يُنفذ nest start
 * 2. nest start → يُنفذ ts-node src/main.ts
 * 3. main.ts → ينشئ التطبيق ويشغله
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// الاستيرادات (Imports)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * NestFactory - المصنع الذي ينشئ تطبيقات NestJS
 * فكر فيه كمصنع السيارات: يأخذ التصميم (AppModule) وينتج السيارة (Application)
 */
import { NestFactory } from '@nestjs/core';

/**
 * ValidationPipe - أنبوب التحقق من صحة البيانات
 * يتحقق من البيانات الواردة قبل وصولها للـ Controller
 *
 * مثال: إذا أرسل المستخدم email غير صالح، يُرفض الطلب مباشرة
 */
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';

/**
 * DocumentBuilder, SwaggerModule - لتوثيق الـ API
 * Swagger = أداة لتوليد صفحة تفاعلية لاختبار الـ API
 * مثال: http://localhost:3000/api/docs
 */
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * ConfigService - للوصول لمتغيرات البيئة
 * بدلاً من: process.env.PORT
 * نستخدم: configService.get('PORT')
 * الفائدة: Type Safety + Default Values + Validation
 */
import { ConfigService } from '@nestjs/config';

/**
 * helmet - حماية HTTP headers
 * يضيف headers أمنية مثل:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - Content-Security-Policy
 */
import helmet from 'helmet';

/**
 * compression - ضغط الاستجابات
 * يقلل حجم البيانات المرسلة للعميل
 * 100KB → ~20KB (توفير 80%!)
 */
import compression from 'compression';

/**
 * AppModule - الوحدة الرئيسية للتطبيق
 * تحتوي على جميع الوحدات الأخرى (Users, Auth, Stores, etc.)
 */
import { AppModule } from './app.module';

/**
 * HttpExceptionFilter - فلتر الأخطاء الموحد
 * يحول جميع الأخطاء لشكل موحد للـ Frontend
 */
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';

/**
 * TransformResponseInterceptor - محول الردود الموحد
 * يحول جميع الردود لشكل موحد للـ Frontend
 */
import { TransformResponseInterceptor } from '@common/interceptors/transform-response.interceptor';

// ═══════════════════════════════════════════════════════════════════════════════
// دالة Bootstrap - تهيئة وتشغيل التطبيق
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * bootstrap - الدالة الرئيسية لتشغيل التطبيق
 *
 * async function = دالة غير متزامنة (Asynchronous)
 * تستخدم await للانتظار حتى اكتمال العمليات
 *
 * لماذا async؟
 * - إنشاء التطبيق يحتاج وقت (الاتصال بقاعدة البيانات، Redis، إلخ)
 * - لا نريد أن "يتجمد" البرنامج أثناء الانتظار
 */
async function bootstrap(): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────────
  // 1️⃣ إنشاء التطبيق
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * NestFactory.create() - ينشئ تطبيق NestJS جديد
   *
   * المعاملات:
   * - AppModule: الوحدة الجذرية (تحتوي كل شيء)
   * - options: خيارات إضافية
   *
   * bufferLogs: true
   * - يجمع السجلات حتى يكتمل التهيئة
   * - ثم يعرضها دفعة واحدة
   * - الفائدة: سجلات مرتبة وليست مبعثرة
   */
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  /**
   * الحصول على ConfigService
   * app.get() يجلب أي خدمة مسجلة في التطبيق
   */
  const configService = app.get(ConfigService);

  /**
   * إنشاء Logger خاص لهذا الملف
   * 'Bootstrap' = اسم السياق (يظهر في السجلات)
   */
  const logger = new Logger('Bootstrap');

  // ─────────────────────────────────────────────────────────────────────────────
  // 2️⃣ إعداد الأمان (Security)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * helmet() - يضيف طبقات حماية متعددة
   *
   * ما يفعله:
   * ─────────
   * ✅ X-Content-Type-Options: nosniff
   *    يمنع المتصفح من "تخمين" نوع الملف
   *    حماية من هجمات MIME-sniffing
   *
   * ✅ X-Frame-Options: SAMEORIGIN
   *    يمنع تضمين الموقع في iframe
   *    حماية من هجمات Clickjacking
   *
   * ✅ X-XSS-Protection: 0
   *    يعطل فلتر XSS القديم (غير موثوق)
   *    CSP أفضل منه
   *
   * ✅ Strict-Transport-Security
   *    يجبر استخدام HTTPS
   *
   * contentSecurityPolicy: false
   * - نعطله مؤقتاً لأنه قد يتعارض مع Swagger
   * - في الإنتاج، فعّله وخصصه حسب احتياجاتك
   */
  app.use(
    helmet({
      contentSecurityPolicy: false, // نعطله للتطوير، فعّله في الإنتاج
    }),
  );

  /**
   * compression() - ضغط الاستجابات
   *
   * كيف يعمل؟
   * ──────────
   * 1. العميل يرسل: Accept-Encoding: gzip, deflate
   * 2. الخادم يضغط البيانات بـ gzip
   * 3. العميل يفك الضغط تلقائياً
   *
   * النتيجة: استجابات أسرع، استهلاك أقل للبيانات
   */
  app.use(compression());

  // ─────────────────────────────────────────────────────────────────────────────
  // 3️⃣ إعداد CORS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * CORS = Cross-Origin Resource Sharing
   * مشاركة الموارد عبر الأصول المختلفة
   *
   * المشكلة:
   * ─────────
   * المتصفح يمنع طلبات JavaScript من موقع إلى موقع آخر
   * مثال: Frontend على localhost:3001 يريد طلب API على localhost:3000
   * بدون CORS: المتصفح يمنع الطلب ❌
   *
   * الحل:
   * ─────
   * نخبر المتصفح: "هذه المواقع مسموح لها بالوصول"
   *
   * origin: configService.get('CORS_ORIGINS')
   * - نقرأ المواقع المسموحة من متغيرات البيئة
   * - مثال: "http://localhost:3001,https://rafiq.sa"
   *
   * credentials: true
   * - نسمح بإرسال الـ cookies
   * - مطلوب للمصادقة
   */
  const corsOrigins = configService.get<string>('CORS_ORIGINS', '*');

  app.enableCors({
    // تحويل النص إلى مصفوفة أو السماح للجميع
    origin: corsOrigins === '*' ? true : corsOrigins.split(','),
    // السماح بإرسال credentials (cookies, authorization headers)
    credentials: true,
    // الطرق المسموحة
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // الـ headers المسموحة
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'X-Tenant-ID', // معرف المستأجر (Multi-tenancy)
      'X-Request-ID', // معرف الطلب (للتتبع)
    ],
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4️⃣ إعداد البادئة العامة (Global Prefix)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * setGlobalPrefix - إضافة بادئة لجميع المسارات
   *
   * بدلاً من: /users, /stores, /auth
   * تصبح: /api/users, /api/stores, /api/auth
   *
   * الفائدة:
   * ─────────
   * - تمييز الـ API عن الملفات الثابتة
   * - سهولة إعداد Nginx/Load Balancer
   * - معيار متعارف عليه
   *
   * exclude: نستثني مسارات معينة من البادئة
   * - / → الصفحة الرئيسية
   * - /health → فحص الصحة (يستخدمه Kubernetes/Docker)
   */
  app.setGlobalPrefix('api', {
    exclude: ['/', 'health', 'health/(.*)'],
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5️⃣ إعداد إصدارات الـ API (Versioning)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * API Versioning - إدارة إصدارات الـ API
   *
   * لماذا نحتاجه؟
   * ──────────────
   * - عندما نغير الـ API، لا نريد كسر التطبيقات القديمة
   * - التطبيق القديم يستخدم v1، الجديد يستخدم v2
   *
   * الأنواع:
   * ─────────
   * 1. URI: /api/v1/users, /api/v2/users (الأكثر شيوعاً)
   * 2. Header: X-API-Version: 1
   * 3. Media Type: Accept: application/vnd.api+json;version=1
   *
   * نستخدم URI لأنه:
   * - الأسهل للفهم والاختبار
   * - واضح في السجلات والتوثيق
   */
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1', // الإصدار الافتراضي
    prefix: 'v', // البادئة: v1, v2, v3...
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6️⃣ إعداد الثقة بالـ Proxy
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Trust Proxy - الثقة بالوسيط
   *
   * المشكلة:
   * ─────────
   * عندما يكون التطبيق خلف Nginx/Load Balancer:
   * - الـ IP الذي يراه التطبيق هو IP الـ Proxy
   * - وليس IP المستخدم الحقيقي
   *
   * الحل:
   * ─────
   * الـ Proxy يرسل IP الحقيقي في header:
   * X-Forwarded-For: 192.168.1.100, 10.0.0.1
   *
   * trust proxy = نثق بهذا الـ header
   *
   * ⚠️ تحذير: فعّله فقط إذا كان التطبيق خلف proxy موثوق!
   */
  if (configService.get<string>('TRUST_PROXY', 'false') === 'true') {
    // app.getHttpAdapter().getInstance() يعطينا Express app
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1); // نثق بأول proxy فقط
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7️⃣ إعداد الـ Pipes العامة
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * ValidationPipe - التحقق من صحة البيانات
   *
   * 🎯 ما هو الـ Pipe؟
   * Pipe = دالة تُنفذ على البيانات قبل وصولها للـ Controller
   *
   * 📝 مثال عملي:
   * ────────────────
   * // في الـ DTO:
   * class CreateUserDto {
   *   @IsEmail()
   *   email: string;
   *
   *   @MinLength(8)
   *   password: string;
   * }
   *
   * // طلب غير صالح:
   * POST /users { email: "invalid", password: "123" }
   *
   * // الاستجابة (بفضل ValidationPipe):
   * {
   *   "statusCode": 400,
   *   "message": [
   *     "email must be an email",
   *     "password must be longer than or equal to 8 characters"
   *   ]
   * }
   */
  app.useGlobalPipes(
    new ValidationPipe({
      /**
       * whitelist: true
       * ─────────────────
       * يحذف أي خصائص غير معرفة في الـ DTO
       *
       * مثال:
       * DTO يقبل: { email, password }
       * المستخدم أرسل: { email, password, isAdmin: true }
       * الـ Controller يستلم: { email, password } ← isAdmin حُذف!
       *
       * الفائدة: حماية من Mass Assignment Attack
       */
      whitelist: true,

      /**
       * forbidNonWhitelisted: true
       * ────────────────────────────
       * بدلاً من حذف الخصائص الزائدة، نرفض الطلب بالكامل
       *
       * إذا أرسل المستخدم خاصية غير معرفة = خطأ 400
       */
      forbidNonWhitelisted: true,

      /**
       * transform: true
       * ─────────────────
       * يحوّل البيانات تلقائياً للنوع الصحيح
       *
       * مثال:
       * الطلب: GET /users/123 ← id هو string
       * الـ DTO: id: number
       * بدون transform: id = "123" (string)
       * مع transform: id = 123 (number)
       */
      transform: true,

      /**
       * transformOptions
       * ─────────────────
       * enableImplicitConversion: true
       * يحوّل الأنواع بناءً على الـ type في TypeScript
       * بدون الحاجة لـ @Type() decorator
       */
      transformOptions: {
        enableImplicitConversion: true,
      },

      /**
       * validationError.target: false
       * ────────────────────────────────
       * لا نضمّن الكائن الأصلي في رسالة الخطأ
       * الفائدة: لا نكشف البيانات الحساسة في الأخطاء
       */
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 7.5️⃣ إعداد Global Exception Filter
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * HttpExceptionFilter - فلتر الأخطاء الموحد
   *
   * يحول جميع الأخطاء لشكل موحد:
   * {
   *   "success": false,
   *   "error": {
   *     "code": "VALIDATION_ERROR",
   *     "message": "البيانات غير صحيحة",
   *     "details": [...],
   *     "timestamp": "...",
   *     "path": "/api/v1/..."
   *   }
   * }
   */
  app.useGlobalFilters(new HttpExceptionFilter());

  // ─────────────────────────────────────────────────────────────────────────────
  // 7.6️⃣ إعداد Global Response Interceptor
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * TransformResponseInterceptor - محول الردود الموحد
   *
   * يحول جميع الردود لشكل موحد:
   * {
   *   "success": true,
   *   "data": { ... },
   *   "meta": {
   *     "timestamp": "...",
   *     "pagination": { ... }
   *   }
   * }
   */
  app.useGlobalInterceptors(new TransformResponseInterceptor());

  // ─────────────────────────────────────────────────────────────────────────────
  // 8️⃣ إعداد Swagger (توثيق الـ API)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Swagger - توثيق تفاعلي للـ API
   *
   * ما هو Swagger؟
   * ───────────────
   * صفحة ويب تعرض جميع endpoints الـ API
   * يمكنك اختبارها مباشرة من المتصفح!
   *
   * الفائدة:
   * ─────────
   * - توثيق تلقائي من الكود
   * - اختبار سريع بدون Postman
   * - مشاركة سهلة مع فريق Frontend
   */
  if (configService.get<string>('SWAGGER_ENABLED', 'true') === 'true') {
    const config = new DocumentBuilder()
      // عنوان الـ API
      .setTitle('Rafiq Platform API')
      // وصف مختصر
      .setDescription(
        `
        🚀 **Rafiq Platform API**
        
        منصة SaaS متكاملة للتسويق الآلي وروبوت الدعم الذكي
        
        ## الميزات الرئيسية:
        - 🔐 مصادقة آمنة (JWT)
        - 🏪 تكامل مع منصة سلة
        - 💬 دعم متعدد القنوات (WhatsApp, Instagram, Discord)
        - 🤖 روبوت دعم ذكي (AI)
        - 📊 تحليلات متقدمة
        
        ## المصادقة:
        استخدم الـ Bearer Token في header:
        \`Authorization: Bearer <your-token>\`
      `,
      )
      // إصدار الـ API
      .setVersion('1.0')
      // إضافة tag للتنظيم
      .addTag('Auth', 'المصادقة وتسجيل الدخول')
      .addTag('Users', 'إدارة المستخدمين')
      .addTag('Tenants', 'إدارة المستأجرين')
      .addTag('Stores', 'إدارة المتاجر')
      .addTag('Channels', 'قنوات التواصل')
      .addTag('Messaging', 'إدارة الرسائل')
      .addTag('AI', 'الذكاء الاصطناعي')
      .addTag('Campaigns', 'الحملات التسويقية')
      .addTag('Analytics', 'التحليلات والتقارير')
      // إضافة طريقة المصادقة
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'أدخل الـ JWT token',
          in: 'header',
        },
        'JWT-auth', // اسم للإشارة إليه لاحقاً
      )
      .build();

    // إنشاء الوثيقة
    const document = SwaggerModule.createDocument(app, config);

    // تسجيل الـ endpoint
    // الوصول: http://localhost:3000/api/docs
    SwaggerModule.setup('api/docs', app, document, {
      // تخصيص الواجهة
      customSiteTitle: 'Rafiq API Docs',
      customfavIcon: '/favicon.ico',
      // إعدادات Swagger UI
      swaggerOptions: {
        persistAuthorization: true, // حفظ الـ token بين الجلسات
        filter: true, // إضافة خانة بحث
        displayRequestDuration: true, // عرض وقت الطلب
      },
    });

    logger.log('📚 Swagger متاح على: /api/docs');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9️⃣ إعداد الإيقاف الآمن (Graceful Shutdown)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Graceful Shutdown - الإيقاف الآمن
   *
   * المشكلة:
   * ─────────
   * عند إيقاف التطبيق فجأة:
   * - طلبات قيد التنفيذ تفشل
   * - اتصالات قاعدة البيانات تبقى مفتوحة
   * - مهام الطابور لا تكتمل
   *
   * الحل:
   * ─────
   * enableShutdownHooks() يجعل NestJS:
   * 1. يستمع لإشارات الإيقاف (SIGTERM, SIGINT)
   * 2. يوقف استقبال طلبات جديدة
   * 3. ينتظر اكتمال الطلبات الحالية
   * 4. يغلق الاتصالات بشكل آمن
   * 5. ثم ينتهي
   */
  app.enableShutdownHooks();

  // ─────────────────────────────────────────────────────────────────────────────
  // 🔟 تشغيل الخادم
  // ─────────────────────────────────────────────────────────────────────────────

  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  await app.listen(port);

  // ─────────────────────────────────────────────────────────────────────────────
  // 📝 طباعة معلومات التشغيل
  // ─────────────────────────────────────────────────────────────────────────────

  logger.log(`
  ════════════════════════════════════════════════════════════════
  🚀 Rafiq Platform is running!
  ════════════════════════════════════════════════════════════════
  
  📍 Environment: ${nodeEnv}
  🔗 URL: http://localhost:${port}
  📚 API Docs: http://localhost:${port}/api/docs
  ❤️  Health: http://localhost:${port}/health
  
  ════════════════════════════════════════════════════════════════
  `);
}

// ═══════════════════════════════════════════════════════════════════════════════
// تنفيذ الدالة الرئيسية
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * bootstrap() تُنفذ هنا
 *
 * .catch() يلتقط أي خطأ أثناء التشغيل
 * ويطبعه ثم ينهي البرنامج بكود خطأ (1)
 *
 * process.exit(1) = إنهاء غير طبيعي (خطأ)
 * process.exit(0) = إنهاء طبيعي (نجاح)
 */
bootstrap().catch((error) => {
  console.error('❌ Failed to start the application:', error);
  process.exit(1);
});
