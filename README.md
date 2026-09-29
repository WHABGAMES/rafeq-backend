# 🚀 Rafiq Platform - منصة رفيق

منصة SaaS متكاملة للتواصل مع العملاء وأتمتة خدمة العملاء لمتاجر سلة.

## 📋 جدول المحتويات

- [نظرة عامة](#نظرة-عامة)
- [المتطلبات](#المتطلبات)
- [التثبيت](#التثبيت)
- [التشغيل](#التشغيل)
- [بنية المشروع](#بنية-المشروع)
- [الـ Modules](#الـ-modules)
- [API Documentation](#api-documentation)

## 🎯 نظرة عامة

منصة رفيق تقدم:
- 🤖 **ذكاء اصطناعي** للرد التلقائي على استفسارات العملاء
- 💬 **صندوق وارد موحد** لجميع قنوات التواصل (WhatsApp, Instagram, Discord)
- 📣 **حملات تسويقية** آلية ومجدولة
- 📊 **تحليلات متقدمة** لأداء الفريق والمحادثات
- 🔗 **تكامل عميق** مع منصة سلة

## 💻 المتطلبات

- Node.js 22 LTS
- PostgreSQL 16+
- Redis 7+
- Docker & Docker Compose (اختياري)

## 🛠️ التثبيت

### 1. استنساخ المشروع

\`\`\`bash
git clone <repository-url>
cd rafiq-platform
\`\`\`

### 2. تثبيت الـ Dependencies

\`\`\`bash
npm install
\`\`\`

### 3. إعداد متغيرات البيئة

\`\`\`bash
cp .env.example .env
# قم بتعديل القيم في ملف .env
\`\`\`

### 4. إعداد قاعدة البيانات

\`\`\`bash
# باستخدام Docker
docker-compose up -d postgres redis

# أو يدوياً
# أنشئ قاعدة بيانات باسم: rafiq_db
\`\`\`

### 5. تشغيل الـ Migrations

\`\`\`bash
npm run migration:run
\`\`\`

## 🚀 التشغيل

### وضع التطوير

\`\`\`bash
npm run start:dev
\`\`\`

### وضع الإنتاج

\`\`\`bash
npm run build
npm run start:prod
\`\`\`

### باستخدام Docker

\`\`\`bash
docker-compose up
\`\`\`

## 📁 بنية المشروع

\`\`\`
rafiq-platform/
├── src/
│   ├── common/              # الأدوات المشتركة
│   │   ├── decorators/      # Custom Decorators
│   │   ├── filters/         # Exception Filters
│   │   ├── guards/          # Auth Guards
│   │   ├── interceptors/    # Request/Response Interceptors
│   │   └── middleware/      # Middleware
│   │
│   ├── config/              # إعدادات التطبيق
│   │   ├── configuration.ts # الإعدادات المركزية
│   │   └── typeorm.config.ts # إعدادات قاعدة البيانات
│   │
│   ├── database/            # قاعدة البيانات
│   │   ├── entities/        # TypeORM Entities
│   │   └── migrations/      # Database Migrations
│   │
│   ├── modules/             # وحدات التطبيق
│   │   ├── auth/            # المصادقة
│   │   ├── users/           # المستخدمين
│   │   ├── tenants/         # المستأجرين
│   │   ├── stores/          # المتاجر
│   │   ├── channels/        # قنوات التواصل
│   │   │   ├── whatsapp/
│   │   │   ├── instagram/
│   │   │   └── discord/
│   │   ├── webhooks/        # Webhooks
│   │   ├── messaging/       # الرسائل
│   │   ├── ai/              # الذكاء الاصطناعي
│   │   ├── campaigns/       # الحملات
│   │   ├── inbox/           # صندوق الوارد
│   │   ├── analytics/       # التحليلات
│   │   └── billing/         # الفوترة
│   │
│   ├── queue/               # BullMQ Queues
│   │
│   ├── app.module.ts        # الوحدة الرئيسية
│   └── main.ts              # نقطة البداية
│
├── docker/                  # Docker files
├── docs/                    # الوثائق
├── scripts/                 # سكربتات مساعدة
├── test/                    # الاختبارات
│
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
\`\`\`

## 📦 الـ Modules

### 🔐 Auth Module
المصادقة وإدارة الجلسات:
- تسجيل الدخول/الخروج
- JWT Tokens
- Refresh Tokens
- تغيير كلمة المرور

### 👥 Users Module
إدارة المستخدمين (موظفين المتجر):
- CRUD للمستخدمين
- الأدوار والصلاحيات
- دعوة المستخدمين

### 🏢 Tenants Module
إدارة المستأجرين (Multi-tenancy):
- إعدادات المستأجر
- إعدادات الذكاء الاصطناعي
- تتبع الاستخدام

### 🏪 Stores Module
تكامل متاجر سلة:
- OAuth مع سلة
- إدارة المتاجر المرتبطة
- مزامنة البيانات

### 📱 Channels Module
قنوات التواصل:
- **WhatsApp**: WhatsApp Business API
- **Instagram**: Instagram Messaging API
- **Discord**: Discord Bot

### 🔔 Webhooks Module
استقبال ومعالجة Webhooks:
- Salla Webhooks
- Payment Webhooks
- التحقق من التوقيع
- Idempotency

### 💬 Messaging Module
إدارة الرسائل والمحادثات:
- إرسال/استقبال الرسائل
- إدارة المحادثات
- تخزين سجل الرسائل

### 🤖 AI Module
الذكاء الاصطناعي:
- OpenAI GPT Integration
- Intent Classification
- Auto-reply
- Handoff to Human

### 📣 Campaigns Module
الحملات التسويقية:
- حملات مجدولة
- حملات مشروطة (Triggered)
- Segmentation
- تحليلات الحملات

### 📥 Inbox Module
صندوق الوارد الموحد:
- عرض جميع المحادثات
- تعيين للموظفين
- الفلترة والبحث
- Real-time Updates

### 📊 Analytics Module
التحليلات والتقارير:
- إحصائيات المحادثات
- أداء الفريق
- تقارير الحملات
- مؤشرات رضا العملاء

### 💰 Billing Module
الفوترة والاشتراكات:
- خطط الاشتراك
- معالجة المدفوعات
- تتبع الاستخدام
- الفواتير

## 📚 API Documentation

بعد تشغيل التطبيق، يمكنك الوصول لوثائق الـ API:

\`\`\`
http://localhost:3000/api/docs
\`\`\`

## 🔑 متغيرات البيئة الرئيسية

| المتغير | الوصف | مثال |
|---------|-------|------|
| DATABASE_URL | رابط قاعدة البيانات | postgresql://user:pass@localhost:5432/rafiq_db |
| REDIS_URL | رابط Redis | redis://localhost:6379 |
| JWT_SECRET | مفتاح JWT | your-super-secret-key |
| SALLA_CLIENT_ID | معرف تطبيق سلة | xxx |
| SALLA_CLIENT_SECRET | سر تطبيق سلة | xxx |
| OPENAI_API_KEY | مفتاح OpenAI | sk-xxx |
| WHATSAPP_ACCESS_TOKEN | توكن WhatsApp | xxx |

## 🧪 الاختبارات

\`\`\`bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
\`\`\`

## 📄 الترخيص

هذا المشروع ملكية خاصة.

---

صُنع بـ ❤️ لمتاجر سلة
