/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ملف app.module.ts - الوحدة الرئيسية للتطبيق
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 📦 ما هي الوحدة (Module)؟
 * الوحدة = مجموعة من الـ Controllers, Services, Entities مرتبطة ببعضها
 *
 * مثال: وحدة Users تحتوي:
 * - UsersController (يستقبل الطلبات)
 * - UsersService (يعالج المنطق)
 * - User Entity (يمثل الجدول)
 *
 * 🌳 هيكل الوحدات في Rafiq:
 * ─────────────────────────────
 *                    AppModule (أنت هنا)
 *                         │
 *         ┌───────────────┼───────────────┐
 *         │               │               │
 *    ConfigModule    DatabaseModule   FeatureModules
 *         │               │               │
 *    (متغيرات      (TypeORM,       ├── AuthModule
 *     البيئة)       PostgreSQL)    ├── UsersModule
 *                                  ├── TenantsModule
 *                                  ├── StoresModule
 *                                  ├── ChannelsModule
 *                                  ├── MessagingModule
 *                                  ├── AIModule
 *                                  ├── CampaignsModule
 *                                  └── AnalyticsModule
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// الاستيرادات
// ═══════════════════════════════════════════════════════════════════════════════

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

// ملفات الإعداد
import configuration from '@config/configuration';
import { typeOrmConfig } from '@config/typeorm.config';

// Middleware
import { RequestLoggerMiddleware } from '@common/middleware/request-logger.middleware';

// Controllers
import { HealthController } from './health.controller';

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 Feature Modules - وحدات الميزات
// ═══════════════════════════════════════════════════════════════════════════════
import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { TenantsModule } from '@modules/tenants/tenants.module';
import { StoresModule } from '@modules/stores/stores.module';
import { ChannelsModule } from '@modules/channels/channels.module';
import { WhatsAppModule } from '@modules/channels/whatsapp/whatsapp.module';
import { EmailModule } from '@modules/channels/email/email.module';
import { SmsModule as SmsChannelModule } from '@modules/channels/sms/sms.module';
import { WebhooksModule } from '@modules/webhooks/webhooks.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { AiModule } from '@modules/ai/ai.module';
import { CampaignsModule } from '@modules/campaigns/campaigns.module';
import { InboxModule } from '@modules/inbox/inbox.module';
import { BillingModule } from '@modules/billing/billing.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';

// ═══════════════════════════════════════════════════════════════════════════════
// 📦 NEW Modules - الوحدات الجديدة
// ═══════════════════════════════════════════════════════════════════════════════
import { TemplatesModule } from '@modules/templates/templates.module';
import { ContactsModule } from '@modules/contacts/contacts.module';

import { IntegrationsModule } from '@modules/integrations/integrations.module';
import { CsatModule } from '@modules/csat/csat.module';
import { QuickRepliesModule } from '@modules/quick-replies/quick-replies.module';
import { TagsModule } from '@modules/tags/tags.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { GatewayModule } from '@modules/gateway/gateway.module';
import { MailModule } from '@modules/mail/mail.module';
import { EmployeeNotificationsModule } from '@modules/employee-notifications/employee-notifications.module';
import { AdminModule } from '@modules/admin/admin.module';

// ═══════════════════════════════════════════════════════════════════════════════
// تعريف الوحدة
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @Module() - Decorator يحول الكلاس إلى وحدة NestJS
 *
 * الخصائص:
 * ─────────
 * - imports: الوحدات التي نستوردها (نستخدم ما فيها)
 * - controllers: الـ Controllers في هذه الوحدة
 * - providers: الـ Services والـ Guards والـ Pipes وغيرها
 * - exports: ما نصدّره للوحدات الأخرى
 */
@Module({
  imports: [
    // ═══════════════════════════════════════════════════════════════════════════
    // 1️⃣ ConfigModule - إدارة متغيرات البيئة
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * ConfigModule.forRoot() - تهيئة على مستوى التطبيق
     *
     * isGlobal: true
     * ─────────────────
     * يجعل ConfigModule متاحاً في كل الوحدات
     * بدونه: نحتاج import في كل وحدة
     * معه: نستخدمه مباشرة في أي مكان
     *
     * load: [configuration]
     * ─────────────────────
     * يحمّل ملف الإعدادات المخصص
     * يحوّل متغيرات البيئة المسطحة إلى كائن متداخل
     *
     * envFilePath
     * ───────────
     * يحدد ملفات .env حسب الأولوية
     * .env.local يتجاوز .env
     *
     * cache: true
     * ───────────
     * يخزن القيم في الذاكرة للوصول الأسرع
     *
     * expandVariables: true
     * ─────────────────────
     * يسمح بمتغيرات داخل متغيرات
     * مثال: API_URL=http://${HOST}:${PORT}
     */
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
      cache: true,
      expandVariables: true,
    }),

    // ═══════════════════════════════════════════════════════════════════════════
    // 2️⃣ TypeOrmModule - قاعدة البيانات
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * TypeOrmModule.forRootAsync() - تهيئة غير متزامنة
     *
     * لماذا Async؟
     * ─────────────
     * نحتاج انتظار تحميل ConfigService قبل إعداد TypeORM
     *
     * inject: [ConfigService]
     * ───────────────────────
     * نطلب من NestJS تمرير ConfigService للـ factory
     *
     * useFactory
     * ──────────
     * دالة تُنشئ الإعدادات
     * تُنفذ عند بدء التطبيق
     */
    TypeOrmModule.forRootAsync(typeOrmConfig),

    // ═══════════════════════════════════════════════════════════════════════════
    // 3️⃣ CacheModule - التخزين المؤقت
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * CacheModule - يسرّع الوصول للبيانات المتكررة
     *
     * كيف يعمل؟
     * ──────────
     * 1. أول طلب: نجلب من قاعدة البيانات + نحفظ في Cache
     * 2. الطلبات التالية: نجلب من Cache (أسرع بكثير!)
     * 3. بعد TTL: Cache ينتهي + نجلب من جديد
     *
     * مثال:
     * - جلب من PostgreSQL: 50ms
     * - جلب من Redis Cache: 1ms
     *
     * 50x أسرع! 🚀
     */
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const ttl = configService.get<number>('REDIS_CACHE_TTL', 3600);

        // في التطوير، قد لا يكون Redis متاحاً
        // نستخدم cache في الذاكرة كبديل
        if (configService.get<string>('NODE_ENV') === 'development') {
          return {
            ttl: ttl * 1000, // تحويل لـ milliseconds
          };
        }

        // في الإنتاج، نستخدم Redis
        // ملاحظة: تحتاج تثبيت cache-manager-redis-yet
        return {
          // store: redisStore,
          // host: configService.get<string>('REDIS_HOST', 'localhost'),
          // port: configService.get<number>('REDIS_PORT', 6379),
          ttl: ttl * 1000,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════════════
    // 4️⃣ BullModule - طوابير المهام الخلفية
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * BullModule - إدارة المهام الخلفية
     *
     * ما هي المهام الخلفية؟
     * ─────────────────────
     * عمليات تستغرق وقتاً ولا نريد أن يبقى المستخدم ينتظر
     *
     * أمثلة:
     * - إرسال بريد إلكتروني
     * - معالجة صورة
     * - إرسال رسالة WhatsApp
     * - تحليل بيانات
     *
     * كيف يعمل؟
     * ──────────
     * 1. الـ Controller يضيف مهمة للطابور
     * 2. يرد للمستخدم فوراً "تم استلام الطلب"
     * 3. الـ Processor يعالج المهمة في الخلفية
     * 4. عند الانتهاء، يُحدّث الحالة أو يرسل إشعار
     *
     * Redis يحفظ الطوابير (لا تضيع عند إعادة التشغيل)
     */
    // ✅ تم تعديله لدعم TLS لـ DigitalOcean Valkey
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        const isProduction = configService.get<string>('NODE_ENV') === 'production';
        const redisTls = configService.get<string>('REDIS_TLS') === 'true' || isProduction;
        
        return {
          connection: {
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            // TLS مطلوب لـ DigitalOcean Managed Redis/Valkey
            ...(redisTls ? { tls: { rejectUnauthorized: false } } : {}),
          },
          // إعدادات افتراضية لجميع المهام
          defaultJobOptions: {
            // عدد محاولات إعادة التنفيذ عند الفشل
            attempts: 3,
            // الانتظار بين المحاولات (بالـ ms)
            backoff: {
              type: 'exponential', // 1s, 2s, 4s, 8s...
              delay: 1000,
            },
            // حذف المهمة بعد الإنجاز (لتوفير الذاكرة)
            removeOnComplete: true,
            // الاحتفاظ بالمهام الفاشلة (للتحليل)
            removeOnFail: false,
          },
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════════════
    // 5️⃣ ScheduleModule - جدولة المهام (Cron Jobs)
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * ScheduleModule - تنفيذ مهام في أوقات محددة
     *
     * أمثلة:
     * - كل ساعة: تنظيف الملفات المؤقتة
     * - كل يوم الساعة 3 صباحاً: نسخ احتياطي
     * - كل أسبوع: إرسال تقرير
     *
     * يستخدم صيغة Cron:
     * ┌───────────── ثانية (اختياري) (0-59)
     * │ ┌─────────── دقيقة (0-59)
     * │ │ ┌───────── ساعة (0-23)
     * │ │ │ ┌─────── يوم الشهر (1-31)
     * │ │ │ │ ┌───── شهر (1-12)
     * │ │ │ │ │ ┌─── يوم الأسبوع (0-7) (0 و 7 = الأحد)
     * │ │ │ │ │ │
     * * * * * * *
     *
     * مثال: '0 3 * * *' = كل يوم الساعة 3 صباحاً
     */
    ScheduleModule.forRoot(),

    // ═══════════════════════════════════════════════════════════════════════════
    // 6️⃣ EventEmitterModule - نظام الأحداث
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * EventEmitterModule - التواصل بين الوحدات عبر الأحداث
     *
     * لماذا الأحداث؟
     * ───────────────
     * - فصل المسؤوليات (Decoupling)
     * - تنفيذ متوازي
     * - سهولة الإضافة والحذف
     *
     * مثال:
     * ────────
     * // عند إنشاء طلب جديد:
     * this.eventEmitter.emit('order.created', { orderId: 123 });
     *
     * // المستمعون يتفاعلون بشكل مستقل:
     * @OnEvent('order.created')
     * handleOrderCreated(payload) {
     *   // إرسال بريد تأكيد
     * }
     *
     * @OnEvent('order.created')
     * handleInventoryUpdate(payload) {
     *   // تحديث المخزون
     * }
     *
     * الفائدة: OrderService لا يعرف شيئاً عن Email أو Inventory
     */
    EventEmitterModule.forRoot({
      // wildcards: true يسمح بأنماط مثل 'order.*'
      wildcard: true,
      // الفاصل بين أجزاء الحدث
      delimiter: '.',
      // أقصى عدد مستمعين لكل حدث
      maxListeners: 20,
    }),

    // ═══════════════════════════════════════════════════════════════════════════
    // 7️⃣ ThrottlerModule - الحماية من الطلبات المتكررة
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * ThrottlerModule - Rate Limiting
     *
     * لماذا نحتاجه؟
     * ──────────────
     * - حماية من هجمات DDoS
     * - منع Brute Force على صفحة الدخول
     * - تقليل حمل الخادم
     * - الحفاظ على العدالة بين المستخدمين
     *
     * كيف يعمل؟
     * ──────────
     * يحسب عدد الطلبات من كل IP خلال فترة معينة
     * إذا تجاوز الحد، يُرفض الطلب بخطأ 429
     *
     * ttl: 60 = فترة 60 ثانية
     * limit: 100 = أقصى 100 طلب
     *
     * النتيجة: 100 طلب في الدقيقة كحد أقصى
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000, // ms
            limit: configService.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
    }),

    // ═══════════════════════════════════════════════════════════════════════════
    // 8️⃣ Feature Modules - وحدات الميزات
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * ترتيب الوحدات مهم!
     * 
     * 📌 هيكل العلاقات:
     *   Auth ─────► Users ─────► Tenants
     *                              │
     *           ┌──────────────────┴──────────────────┐
     *           │                                     │
     *        Stores                              Channels
     *           │                                     │
     *        Webhooks ◄───────────────────────────────┘
     *           │
     *        Messaging ◄────────── AI
     *           │
     *    ┌──────┴──────┐
     *    │             │
     * Campaigns     Inbox
     *    │             │
     *    └──────┬──────┘
     *           │
     *      Analytics ───► Billing
     */
    
    // 🔐 المصادقة والمستخدمين
    AuthModule,
    UsersModule,
    TenantsModule,
    
    // 🏪 المتاجر والقنوات
    StoresModule,
    ChannelsModule,
    WhatsAppModule,       // ✅ واتساب routes (webhook, send, etc.)
    EmailModule,          // ✅ قناة البريد الإلكتروني (SMTP, SendGrid, Mailgun, SES)
    SmsChannelModule,     // ✅ قناة SMS (Unifonic, Taqnyat, Gateway, Twilio)
    WebhooksModule,
    
    // 💬 الرسائل والذكاء الاصطناعي
    MessagingModule,
    AiModule,
    
    // 📣 الحملات وصندوق الوارد
    CampaignsModule,
    InboxModule,
    
    // 📊 التحليلات والفواتير
    AnalyticsModule,
    BillingModule,

    // ═══════════════════════════════════════════════════════════════════════════
    // 📦 NEW Modules - الوحدات الجديدة
    // ═══════════════════════════════════════════════════════════════════════════
    
    // 📝 القوالب والرسائل الآلية
    TemplatesModule,
    
    // 👥 العملاء والتصنيفات
    ContactsModule,
    TagsModule,
    
    // 🔗 التكاملات (سلة، زد، شوبيفاي)
    IntegrationsModule,
    
    // ⚡ الردود السريعة
    QuickRepliesModule,
    
    // ⭐ رضا العملاء
    CsatModule,
    
    // ⚙️ الإعدادات العامة
    SettingsModule,

    // 🔌 WebSocket Gateway
    GatewayModule,

    // 📧 Mail Module للـ OTP
    MailModule,

    // 🔔 تنبيهات الموظفين
    EmployeeNotificationsModule,

    // 🛡️ لوحة الأدمن — إدارة المنصة
    AdminModule,
  ],

  // ═══════════════════════════════════════════════════════════════════════════════
  // Controllers
  // ═══════════════════════════════════════════════════════════════════════════════
  controllers: [
    HealthController, // فحص صحة التطبيق
  ],

  // ═══════════════════════════════════════════════════════════════════════════════
  // Providers - الخدمات والـ Guards العامة
  // ═══════════════════════════════════════════════════════════════════════════════
  providers: [
    // ─────────────────────────────────────────────────────────────────────────────
    // Global Guards - الحراس العامون
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * ThrottlerGuard - يُطبق Rate Limiting
     *
     * يفحص كل طلب: هل تجاوز الحد؟
     * نعم = رفض بخطأ 429
     * لا = السماح بالمرور
     */
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * configure - إعداد الـ Middleware
   *
   * NestModule = Interface يجبرنا على تنفيذ configure()
   *
   * Middleware vs Interceptor:
   * ─────────────────────────────
   * Middleware: يعمل على Express level (قبل NestJS)
   * Interceptor: يعمل على NestJS level (أكثر تكاملاً)
   *
   * Middleware أفضل لـ:
   * - تسجيل الطلبات
   * - إضافة headers
   * - معالجة CORS (لكن NestJS لديه طريقة أسهل)
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      // الـ Middleware المراد تطبيقه
      .apply(RequestLoggerMiddleware)
      // تطبيقه على جميع المسارات
      .forRoutes('*');
  }
}
