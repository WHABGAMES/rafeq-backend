# 📋 سجل التحديثات — RAFEQ (UPDATE HISTORY)

> **قبل أن تقرأ:** هذا الملف **إلزامي**. أي مطوّر أو بوت برمجة يعدّل المشروع **يجب** أن يفتح هذا الملف ويكتب فيه تفاصيل تعديله. اقرأ `README_DEVELOPERS.md` أولاً.

---

## 🔖 نظام النُّسخ (Versioning)

- كل ملف يُعدّل يأخذ رقم نسخة يزيد بمقدار 1 عند كل تعديل: `v1`, `v2`, `v3` ...
- عند تعديل ملف موجود، ابحث عن آخر نسخة له في هذا السجل وزِد الرقم.
- الصيغة عند ذكر ملف: `المسار (vN)` — مثال: `src/main.ts (v2)`.
- جدول «سجل نُسخ الملفات» في أسفل هذا المستند يتتبّع آخر نسخة لكل ملف.

## 📝 قالب التدوين الإلزامي (انسخه لكل تعديل جديد)

```
### [YYYY-MM-DD] — <معرّف الإصلاح> — <عنوان مختصر>
- **النسخة:** <اسم الملف> vN
- **المشكلة:** <وصف دقيق للمشكلة/الثغرة وأثرها>
- **السبب الجذري:** <لماذا حدثت — لا الأعراض>
- **طريقة الحل:** <ما الذي تغيّر بالضبط وكيف عالج السبب>
- **الملفات:** <المسارات الكاملة + النسخة الجديدة>
- **المخاطر/الملاحظات:** <أي أثر جانبي، خطوة تشغيلية، أو اعتماد>
- **التحقق:** <كيف تأكدنا أنه يعمل — صياغة/أنواع/محاكاة>
```

---

# ✅ المراحل المنتهية

## المرحلة الفورية (Immediate)

### [2026-07-27] — F-01 — فرض وضع القراءة فقط أثناء انتحال الأدمن
- **النسخة:** impersonation-readonly.interceptor.ts v1 · app.module.ts v2 · api.ts (frontend) v2 · ImpersonationBanner.tsx v1 · dashboard/layout.tsx v2
- **المشكلة:** توكن انتحال الأدمن يحمل `viewOnly` لكن لا شيء يفرضه — كان بإمكان الأدمن تنفيذ عمليات كتابة على حساب التاجر.
- **السبب الجذري:** غياب حارس يفحص `_viewOnly` ويمنع الطلبات غير GET.
- **طريقة الحل:** interceptor عام (`APP_INTERCEPTOR`) يمنع أي طلب غير GET عندما `user._viewOnly=true`. شريط تنبيه في الواجهة.
- **الملفات:** `backend/src/common/interceptors/impersonation-readonly.interceptor.ts` (جديد) · `backend/src/app.module.ts` · `frontend/lib/api.ts` · `frontend/components/ImpersonationBanner.tsx` (جديد) · `frontend/app/dashboard/layout.tsx`
- **التحقق:** صياغة + محاكاة طلبات الكتابة أثناء الانتحال.

### [2026-07-27] — F-02 — فحص القائمة السوداء للتوكن في JwtStrategy
- **النسخة:** jwt.strategy.ts v2
- **المشكلة:** التوكنات المُبطَلة (logout) كانت تُضاف لـ `token_blacklist` لكن `JwtStrategy` لم يفحصها → توكن مُبطَل يبقى صالحاً.
- **السبب الجذري:** غياب فحص blacklist في `validate()`.
- **طريقة الحل:** فحص `token_blacklist:{jti}` في أعلى `validate()` (قبل فرع الانتحال). fail-open عند خطأ Redis، fail-closed عند وجود التوكن في القائمة.
- **الملفات:** `backend/src/modules/auth/strategies/jwt.strategy.ts`
- **التحقق:** تتبّع الترتيب (blacklist قبل الانتحال).

### [2026-07-27] — F-03 — CORS صارم بدل allow-all
- **النسخة:** main.ts v2 · package.json v2
- **المشكلة:** CORS كان يسمح لأي origin مع credentials.
- **طريقة الحل:** delegate واعٍ بالمسار: مسارات embed العامة (origin:true, credentials:false)، الباقي allowlist صارم + credentials. أُضيف `cors` + `@types/cors`.
- **الملفات:** `backend/src/main.ts` · `backend/package.json`
- **المخاطر:** ⚠️ يتطلب `npm install` (حزمة cors جديدة).

### [2026-07-27] — F-04 — فرض TLS لقاعدة البيانات (fail-closed)
- **النسخة:** typeorm.config.ts v2
- **المشكلة:** `rejectUnauthorized:false` fallback → اتصال DB غير مُتحقَّق منه.
- **طريقة الحل:** الإنتاج بلا شهادة CA → يرمي خطأ (لا يُقلع) إلا بـ `DB_ALLOW_INSECURE_SSL=true` صريح.
- **الملفات:** `backend/src/config/typeorm.config.ts`
- **المخاطر:** ⚠️ الإنتاج لن يُقلع حتى توفير CA أو الـ opt-out.

### [2026-07-27] — F-10 — فصل سرّ توكن التجديد
- **النسخة:** auth.service.ts v2
- **المشكلة:** `JWT_REFRESH_SECRET` يرجع لـ `JWT_SECRET` عند غيابه.
- **طريقة الحل:** `resolveRefreshSecret()` — الإنتاج يرمي خطأ إن غاب السر (لا fallback).
- **الملفات:** `backend/src/modules/auth/auth.service.ts`
- **المخاطر:** ⚠️ توليد `JWT_REFRESH_SECRET` مستقل وإلا لن يُقلع الإنتاج.

### [2026-07-27] — F-05 — التحقق من مخطط روابط الاختصار
- **النسخة:** short-links.service.ts v2 · short-links/page.tsx v2
- **المشكلة:** روابط الاختصار تقبل أي مخطط (`javascript:` ...).
- **طريقة الحل:** `validateHttpUrl()` (http/https فقط) في مسارَي الإنشاء **والتحديث**.
- **الملفات:** `backend/src/modules/short-links/short-links.service.ts` · `frontend/app/dashboard/short-links/page.tsx`

## المرحلة قصيرة المدى (Short-term)

### [2026-07-27] — F-06 — حدّ معدّل OTP على Redis (بدل الذاكرة)
- **النسخة:** redis.module.ts v1 · app.module.ts v3 · otp-relay.service.ts v2 · otp-inventory.service.ts v2
- **المشكلة:** حدّ معدّل OTP في ذاكرة العملية → غير موثوق عبر النسخ.
- **طريقة الحل:** `RedisModule` عالمي (`@Global`) بمزوّد `REDIS_CLIENT` واحد. حدّ المعدّل عبر Lua atomic (`INCR`+`EXPIRE` ذرّي) لتفادي سباق الحظر الدائم. fallback للذاكرة (fail-open).
- **الملفات:** `backend/src/common/redis/redis.module.ts` (جديد) · `backend/src/app.module.ts` · `backend/src/modules/otp-relay/otp-relay.service.ts` · `backend/src/modules/otp-relay/otp-inventory.service.ts`

### [2026-07-27] — F-09 — رفض webhooks زد لمتاجر غير معروفة
- **النسخة:** zid-webhooks.controller.ts v2 · zid-webhooks.service.ts v2
- **طريقة الحل:** `isKnownZidStore()` يرفض webhooks لمتاجر غير مربوطة (يستثني أحداث app-market التي تسبق الربط).
- **الملفات:** `backend/src/modules/webhooks/zid-webhooks.controller.ts` · `backend/src/modules/webhooks/zid-webhooks.service.ts`

### [2026-07-27] — F-11 — إزالة الأسرار الحقيقية من `.env.production`
- **النسخة:** .env.example v2
- **المشكلة:** `.env.production` يحوي أسرار Salla حيّة (client secret/webhook secret 64 حرفاً، DB password).
- **طريقة الحل:** استكمال `.env.example` النظيف (78 مفتاحاً، قيم placeholder فقط).
- **الملفات:** `backend/.env.example`
- **المخاطر:** ⚠️🔴 **عاجل:** تدوير (rotate) أسرار Salla المسرّبة + حذف `.env.production` الحقيقي من أي أرشيف.

### [2026-07-27] — F-12 — إيقاف تسجيل مقاطع التوكنات
- **النسخة:** zid-oauth.service.ts v2 · telegram.service.ts v2 · csat.service.ts v2
- **المشكلة:** تسجيل 30 حرفاً من access_token (zid)، 10 من bot token (telegram)، 8 من survey token (csat).
- **طريقة الحل:** الطول فقط بدل المقطع؛ csat يسجّل `survey.id`.
- **الملفات:** `backend/src/modules/stores/zid-oauth.service.ts` · `backend/src/modules/channels/telegram/telegram.service.ts` · `backend/src/modules/csat/csat.service.ts`

### [2026-07-27] — F-23 — تصليب توكن الانتحال
- **النسخة:** admin-auth.controller.ts v2
- **المشكلة:** توكن الانتحال عمره ساعتان، بلا jti، لا يمكن إبطاله مبكراً.
- **طريقة الحل:** `jti` فريد + عمر 30 دقيقة + نقطة `POST impersonate/:jti/end` تُبطل عبر `token_blacklist` (بنية F-02). Redis اختياري؛ الإبطال fail-loud (لا نجاح كاذب)، البدء best-effort.
- **الملفات:** `backend/src/modules/admin/controllers/admin-auth.controller.ts`

### [2026-07-27] — F-07 — نقل توكن التجديد إلى كوكي httpOnly
- **النسخة:** auth.controller.ts v2 · auth/dto/index.ts v2 · api.ts v3 · api-client.ts v2 · auth/login/page.tsx v2 · auth/verify/page.tsx v2 · auth/set-password/page.tsx v2 · auth/callback/page.tsx v2 · auth/callback/google|salla|zid/page.tsx v2 · dashboard/layout.tsx v3
- **المشكلة:** توكن التجديد في localStorage → عرضة لسرقة XSS.
- **السبب الجذري:** لا كوكي httpOnly؛ الواجهة تخزّن التجديد في JS-readable storage.
- **طريقة الحل:** كوكي `rafeq_rt` (httpOnly/secure/sameSite=strict/path=/api/auth). 7 نقاط إصدار تضبطه، refresh يقرأه (fallback للجسم) ويدوّره ويمسحه عند الفشل، logout يمسحه. الواجهة ترسل credentials وتخزّن access فقط. هجرة تدريجية غير كاسرة.
- **الملفات:** انظر الأسماء أعلاه (backend: `src/modules/auth/*` · frontend: `lib/*`, `app/auth/*`, `app/dashboard/layout.tsx`).
- **المخاطر:** ⚠️ `CORS_ORIGINS` يجب أن يتضمّن نطاق الواجهة. تحسين مستقبلي: `set-password` تستقبل refresh عبر URL query.
- **التحقق:** محاكاة رحلة المستخدم (قديم/جديد)، سباق 401، CSRF، same-site cookie، إصلاح طرد المستخدم من dashboard.

## المرحلة متوسطة المدى (Medium-term)

### [2026-07-27] — F-13 — إصلاح ترويسة XSS + إضافة CSP للواجهة
- **النسخة:** next.config.js v2
- **المشكلة:** `X-XSS-Protection: 1; mode=block` مهجورة (قد تُدخل ثغرات)؛ لا CSP على الواجهة.
- **طريقة الحل:** `X-XSS-Protection: 0` + CSP متوافق مع Next.js (يستخرج origin الـ API عبر `new URL().origin`). `connect-src` متطابق مع helmet الخادم.
- **الملفات:** `frontend/next.config.js`
- **التحقق:** تحميل الملف كوحدة Node، محاكاة موارد CSP (سكربتات/خطوط/صور/OAuth/fetch)، تناسق مع الخادم.

### [2026-07-27] — F-15 — نقل migration شارد + حذف `src/src`
- **النسخة:** 1706800000000-AddSourceToWebhookEvents.ts v1
- **المشكلة:** الكيان `webhook-event` يعرّف عمود `source` ويفهرسه، لكن migration إنشائه شارد في `src/src/migrations` (لا يُحمَّل) → العمود قد يكون مفقوداً في الإنتاج.
- **طريقة الحل:** نقل الـ migration للمجلد الرسمي، idempotent (يفحص وجود العمود) + آمن على البيانات (`'system'` مؤقت ثم DROP DEFAULT).
- **الملفات:** `backend/src/database/migrations/1706800000000-AddSourceToWebhookEvents.ts`
- **المخاطر:** ⚠️ **إجراء حذف:** `rm -rf src/src` في الـ backend.
- **التحقق:** محاكاة تشغيل migration (ذرّية transaction، ترتيب timestamp، ADD COLUMN على بيانات قائمة).

### [2026-07-27] — F-17 — إزالة الحالة العابرة من edge middleware
- **النسخة:** middleware.ts v2
- **المشكلة:** `Map` لإزالة تكرار السجلات في edge middleware → غير موثوقة (نسخ معزولة) + تسرّب ذاكرة.
- **طريقة الحل:** إزالة الحالة (Map + shouldLog + lastCleanup)، تسجيل مباشر.
- **الملفات:** `frontend/middleware.ts`

### [2026-07-27] — F-21 — توحيد كلمات المرور على argon2id
- **النسخة:** password.util.ts v2 · auth.service.ts v3 · auto-registration.service.ts v2 · users.service.ts v2 · admin-users.service.ts v2 · user.entity.ts v2
- **المشكلة:** كلمات مرور التجار بـ bcryptjs (أضعف من argon2id/OWASP).
- **السبب الجذري:** لا أداة موحّدة؛ لا يمكن إعادة تجزئة كلمات المرور (لا نملك النص الأصلي).
- **طريقة الحل:** أداة `password.util` — argon2id للجديد، كشف تلقائي للنوع، **هجرة شفافة** (rehash-on-login مرة واحدة لكل تاجر). argon2 يُحمّل كسولاً (dynamic import) — آمن في سياق الكيانات/migrations. الكيان يستورد بمسار نسبي.
- **الملفات:** `backend/src/common/utils/password.util.ts` (جديد) + 5 ملفات.
- **التحقق:** محاكاة دورة الهجرة الكاملة بالمكتبات الحقيقية (argon2@0.31 + bcryptjs@2)، حالات حدّية، مستخدمو OAuth، tsconfig صارم، تكامل NestJS.

### [2026-07-27] — F-18 — تحصين حقن الأوامر في الذكاء الاصطناعي
- **النسخة:** prompt-sanitizer.util.ts v1 · ai.service.ts v2
- **المشكلة:** محتوى غير موثوق (اسم العميل، مقاطع RAG، رسائل العميل) يُحقن في الـ system prompt دون تحصين → prompt injection.
- **طريقة الحل:** أداة `prompt-sanitizer` تُحيّد أنماط الحقن (علامات أدوار، «تجاهل التعليمات»، فواصل أقسام) دون كسر المحتوى الشرعي + توجيه مضاد للحقن في الـ prompt (عربي/إنجليزي).
- **الملفات:** `backend/src/common/utils/prompt-sanitizer.util.ts` (جديد) · `backend/src/modules/ai/ai.service.ts`
- **التحقق:** اختبار الأداة على هجمات حقن حقيقية + محتوى شرعي؛ تغطية كل مسارات بناء الـ prompt.

### [2026-07-27] — F-16 — تعطيل التحويل الضمني في ValidationPipe
- **النسخة:** main.ts v3 · 21 controller v(+1) لكلٍّ
- **المشكلة:** `enableImplicitConversion: true` يحوّل الأنواع بصمت حسب نوع TS، فقد يتجاوز نية التحقق (مثل `"1abc"` → `1`).
- **السبب الجذري:** الاعتماد على تحويل ضمني عام بدل تحويل صريح لكل معامل.
- **طريقة الحل:** أضفت `ParseIntPipe`/`ParseBoolPipe({ optional: true })` لـ**كل** معامل query رقمي/بوليان (81+ معامل عبر 21 ملفاً)، ثم عطّلت التحويل الضمني في `main.ts`. النطاق أوسع من المتوقّع (نمط القيمة الافتراضية `page = 1`). الملف `admin.controllers.ts` (جمع) كاد يفوت الفحص.
- **الملفات:** `backend/src/main.ts` + 21 controller (admin-inbox, admin-users, admin.controllers, admin-subscriptions, analytics, automations, billing, campaigns, contacts, csat, email, sms, inbox, integrations, platform-notifications, quick-replies, short-links, suggestions×2, templates, webhooks).
- **المخاطر/الملاحظات:** ⚠️ عملاء API خارجيون سيحصلون على 400 عند معامل رقمي غير صالح (`?page=abc`) بدل تجاهله — تحسين أمني مقصود، وثّقه لهم. الواجهة الداخلية غير متأثرة (تبني query params بأمان).
- **التحقق:** محاكاة سلوك الـ pipe بمدخلات حدّية على NestJS 10 الحقيقي؛ الواجهة لا ترسل قيماً فارغة؛ `page || 1` يعالج undefined؛ صفر معامل بلا حماية.

### [2026-07-27] — F-08 + F-22 — توحيد المخطط وفصل اقتران bootstrap
- **النسخة:** ConsolidateAdminSchema1775600000000.ts v1
- **المشكلة:** أربعة جداول إدارية (audit_logs, admin_notification_templates, admin_alert_recipients, message_logs) تُنشأ فقط داخل `onModuleInit` للخدمات (اقتران المخطط بدورة حياة الخدمة — F-22)، ولا يملكها أي migration (F-08).
- **السبب الجذري:** إنشاء المخطط مُدمج في دورة حياة الخدمة بدل migrations.
- **طريقة الحل:** migration موحّد ينشئ الجداول الأربعة idempotent (نفس DDL الخدمات بالضبط). المخطط يصبح مملوكاً للـ migrations (F-08) ومنفصلاً عن دورة حياة الخدمة (F-22). أُبقي DDL الخدمات كما هو لعدم كسر النشرات القائمة (متناغم لا متعارض). التراجع no-op آمن (لا نُسقط جداول تدقيق حيّة).
- **الملفات:** `backend/src/database/migrations/ConsolidateAdminSchema1775600000000.ts` (جديد)
- **التحقق:** **تشغيل فعلي على PostgreSQL 16 حقيقي:** كل الاستعلامات نجحت، idempotent (تشغيل مرتين)، قواعد عدم القابلية للتعديل تعمل فعلياً، تطابق بنيوي تام migration↔خدمة (14+17+12+15 عمود).

## المرحلة المعلوماتية (Informational)

### [2026-07-27] — F-19 + F-20 — تدقيق أمني في CI + اختبارات الأمان
- **النسخة:** ci.yml v2 · password.util.spec.ts v1 · prompt-sanitizer.util.spec.ts v1
- **المشكلة:** لا تدقيق ثغرات آلي (F-19)، لا اختبارات ترسّخ الإصلاحات الأمنية (F-20).
- **طريقة الحل:** GitHub Actions يشغّل `npm audit` + `npm run build` + `npm test` للواجهتين عند push/PR. اختبارات لـ password.util (F-21) و prompt-sanitizer (F-18) — 28 اختباراً.
- **الملفات:** `RAFEQ/.github/workflows/ci.yml` (جديد) · `backend/src/common/utils/__tests__/password.util.spec.ts` (جديد) · `backend/src/common/utils/__tests__/prompt-sanitizer.util.spec.ts` (جديد)
- **المخاطر/الملاحظات:** ⚠️ `npm audit` مبدئياً `continue-on-error` (لا يكسر CI على ثغرات قائمة)؛ أزل ذلك بعد تنظيف التبعيات ليصبح إلزامياً. البناء يستخدم `npm run build` الفعلي (لا tsc أصرم).
- **التحقق:** تشغيل الاختبارات بإعداد jest/tsconfig الفعلي للمشروع (28/28)، وضمن المجموعة مع اختبار موجود (36/36)؛ YAML صحيح؛ مسارات وأوامر CI مؤكَّدة.

---

# ⏳ المراحل المتبقية

> ✅ **اكتملت كل إصلاحات التدقيق الأمني (F-01 → F-23).** لم يتبقَّ سوى تحسينات واجهة غير أمنية حرجة.

### تحسينات واجهة مؤجّلة (غير أمنية حرجة)
- زر «إنهاء الانتحال» في لوحة الأدمن (نقطة `impersonate/:jti/end` جاهزة في الخادم، الواجهة لا تستدعيها بعد).
- إصلاح `set-password`: استقبال refresh عبر URL query (تسريب محتمل) → تعديل مسار redirect في الخادم.

---

# 📁 سجل نُسخ الملفات (آخر نسخة لكل ملف)

| الملف | آخر نسخة | آخر إصلاح |
|---|---|---|
| `backend/src/main.ts` | v3 | F-16 |
| `backend/src/app.module.ts` | v3 | F-06 |
| `backend/src/config/typeorm.config.ts` | v2 | F-04 |
| `backend/src/modules/auth/strategies/jwt.strategy.ts` | v2 | F-02 |
| `backend/src/modules/auth/auth.service.ts` | v3 | F-21 |
| `backend/src/modules/auth/auth.controller.ts` | v2 | F-07 |
| `backend/src/modules/auth/dto/index.ts` | v2 | F-07 |
| `backend/src/modules/auth/auto-registration.service.ts` | v2 | F-21 |
| `backend/src/common/interceptors/impersonation-readonly.interceptor.ts` | v1 | F-01 |
| `backend/src/common/redis/redis.module.ts` | v1 | F-06 |
| `backend/src/common/utils/password.util.ts` | v2 | F-21 |
| `backend/src/common/utils/prompt-sanitizer.util.ts` | v1 | F-18 |
| `backend/src/modules/short-links/short-links.service.ts` | v2 | F-05 |
| `backend/src/modules/otp-relay/otp-relay.service.ts` | v2 | F-06 |
| `backend/src/modules/otp-relay/otp-inventory.service.ts` | v2 | F-06 |
| `backend/src/modules/webhooks/zid-webhooks.controller.ts` | v2 | F-09 |
| `backend/src/modules/webhooks/zid-webhooks.service.ts` | v2 | F-09 |
| `backend/src/modules/stores/zid-oauth.service.ts` | v2 | F-12 |
| `backend/src/modules/channels/telegram/telegram.service.ts` | v2 | F-12 |
| `backend/src/modules/csat/csat.service.ts` | v2 | F-12 |
| `backend/src/modules/admin/controllers/admin-auth.controller.ts` | v2 | F-23 |
| `backend/src/modules/admin/services/admin-users.service.ts` | v2 | F-21 |
| `backend/src/modules/users/users.service.ts` | v2 | F-21 |
| `backend/src/modules/ai/ai.service.ts` | v2 | F-18 |
| `backend/src/database/entities/user.entity.ts` | v2 | F-21 |
| `backend/src/database/migrations/1706800000000-AddSourceToWebhookEvents.ts` | v1 | F-15 |
| `backend/.env.example` | v2 | F-11 |
| `backend/package.json` | v2 | F-03 |
| `frontend/next.config.js` | v2 | F-13 |
| `frontend/middleware.ts` | v2 | F-17 |
| `frontend/lib/api.ts` | v3 | F-07 |
| `frontend/lib/api-client.ts` | v2 | F-07 |
| `frontend/components/ImpersonationBanner.tsx` | v1 | F-01 |
| `frontend/app/dashboard/layout.tsx` | v3 | F-07 |
| `frontend/app/auth/login/page.tsx` | v2 | F-07 |
| `frontend/app/auth/verify/page.tsx` | v2 | F-07 |
| `frontend/app/auth/set-password/page.tsx` | v2 | F-07 |
| `frontend/app/auth/callback/page.tsx` | v2 | F-07 |
| `frontend/app/auth/callback/google/page.tsx` | v2 | F-07 |
| `frontend/app/auth/callback/salla/page.tsx` | v2 | F-07 |
| `frontend/app/auth/callback/zid/page.tsx` | v2 | F-07 |
| `frontend/app/dashboard/short-links/page.tsx` | v2 | F-05 |
| `backend/src/database/migrations/ConsolidateAdminSchema1775600000000.ts` | v1 | F-08/F-22 |
| `backend/src/common/utils/__tests__/password.util.spec.ts` | v1 | F-20 |
| `backend/src/common/utils/__tests__/prompt-sanitizer.util.spec.ts` | v1 | F-20 |
| `.github/workflows/ci.yml` | v2 | F-19/F-20 |
| `backend/src/modules/admin/controllers/admin.controllers.ts` | v(+1) | F-16 |
| `backend/src/modules/admin/controllers/admin-inbox.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/admin/controllers/admin-users.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/admin/controllers/admin-subscriptions.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/analytics/analytics.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/automations/automations.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/billing/billing.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/campaigns/campaigns.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/contacts/contacts.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/csat/csat.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/channels/email/email.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/channels/sms/sms.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/inbox/inbox.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/integrations/integrations.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/platform-notifications/admin-platform-notifications.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/quick-replies/quick-replies.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/short-links/short-links.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/suggestions/suggestions.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/suggestions/admin-suggestions.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/templates/templates.controller.ts` | v(+1) | F-16 |
| `backend/src/modules/webhooks/webhooks.controller.ts` | v(+1) | F-16 |

> ملاحظة: `v(+1)` تعني زيادة نسخة واحدة عن آخر نسخة معروفة للملف (معظم الـ controllers كانت v1 → صارت v2؛ إن سبق تعديل ملف، احسب من نسخته الأخيرة).
