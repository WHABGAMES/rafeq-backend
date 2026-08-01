# 📦 دليل تركيب إصلاحات RAFEQ الأمنية (كل الملفات)

هذه الحزمة تحوي **كل الملفات المعدّلة والجديدة** من التدقيق الأمني الكامل (F-01 → F-23).
بنية المجلدات هنا **تطابق مسارات التركيب** — انسخ محتوى `backend/` و`frontend/` و`.github/` إلى جذور مشروعك المقابلة.

## 🗂️ خريطة التركيب

| مجلد الحزمة | يُركّب في |
|---|---|
| `backend/*` | جذر الـ backend (`.../rafeq-backend-main/`) |
| `frontend/*` | جذر الواجهة (`.../rafeq-main/rafeq-frontend/`) |
| `.github/workflows/ci.yml` | جذر المستودع (`RAFEQ/.github/workflows/`) |
| `UPDATE_HISTORY.md` · `README_DEVELOPERS.md` | جذر المشروع (`RAFEQ/`) |

> كل ملف في مساره الكامل داخل الحزمة — فقط طابق الشجرة. الملفات ذات الأسماء المكرّرة (`page.tsx`, `layout.tsx`, `index.ts`) موضوعة في مساراتها الصحيحة فتُركّب كما هي.

---

## ⚙️ خطوات تشغيلية إلزامية (بعد نسخ الملفات)

### 1. تثبيت الحزم (F-03)
```bash
cd backend/rafeq-backend-main
npm install          # cors + @types/cors أُضيفتا إلى package.json
```

### 2. متغيّرات البيئة (F-04, F-10, F-11) — 🔴 حرج
- **F-11:** دوّر (rotate) أسرار Salla المسرّبة فوراً (client secret / webhook secret)، واحذف أي `.env.production` حقيقي من الأرشيفات. استخدم `.env.example` كقالب.
- **F-10:** ولّد `JWT_REFRESH_SECRET` مستقلاً (الإنتاج لن يُقلع بدونه).
- **F-04:** وفّر شهادة CA لقاعدة البيانات، أو اضبط `DB_ALLOW_INSECURE_SSL=true` صراحةً (غير مُوصى به للإنتاج).
- **F-07:** تأكد أن `CORS_ORIGINS` يتضمّن نطاق الواجهة (للكوكي httpOnly).

### 3. حذف مجلد يتيم (F-15) — إجراء حذف
```bash
cd backend/rafeq-backend-main
rm -rf src/src        # migration شارد نُقل لمكانه الصحيح
```

### 4. تشغيل الـ migrations (F-08, F-15, F-22)
```bash
cd backend/rafeq-backend-main
npm run migration:run   # يطبّق: AddSourceToWebhookEvents + ConsolidateAdminSchema
```

### 5. التحقق
```bash
npm run build           # فحص البناء
npm test                # اختبارات الأمان (F-20) — يجب 28/28
```

---

## 🔐 ملاحظات هجرة تلقائية (بلا تدخّل)

- **F-21 (كلمات المرور):** الهجرة من bcrypt إلى argon2id **تلقائية شفافة** — تحدث مرة واحدة لكل تاجر عند أول تسجيل دخول ناجح. لا خطوة يدوية.
- **F-16 (query params):** عملاء API الخارجيون سيحصلون على `400` عند معامل رقمي غير صالح (`?page=abc`) بدل تجاهله — تحسين أمني مقصود، وثّقه لهم. الواجهة الداخلية غير متأثرة.
- **F-19 (CI):** `npm audit` مبدئياً `continue-on-error` (لا يكسر CI على ثغرات قائمة). بعد تنظيف التبعيات، أزل `continue-on-error` من `ci.yml` ليصبح إلزامياً.

---

## 📋 قبل أي تعديل مستقبلي

اقرأ `README_DEVELOPERS.md` → افتح `UPDATE_HISTORY.md` → عدّل بحذر → دوّن ما فعلت → حدّث سجل النُّسخ.

---

## ✅ حالة التدقيق

كل الـ 23 نتيجة أمنية (F-01 → F-23) **مُعالَجة ومُتحقَّق منها**. المتبقّي: تحسينان للواجهة غير أمنيَّين حرجَين (زر إنهاء الانتحال، إصلاح تسريب set-password refresh عبر URL) — موثّقان في `UPDATE_HISTORY.md`.
