# 📚 RAFIQ Platform - API Documentation
# وثائق API منصة رفيق الشاملة

## 🎯 نظرة عامة

منصة رفيق هي منصة متكاملة لخدمة العملاء عبر قنوات متعددة، مصممة خصيصاً للسوق السعودي والعربي.

**Base URL:** `https://api.rafiq.ai/v1`

---

## 📋 جدول المحتويات

1. [المصادقة (Auth)](#1-المصادقة-auth)
2. [القوالب (Templates)](#2-القوالب-templates)
3. [العملاء (Contacts/CRM)](#3-العملاء-contactscrm)
4. [الأتمتة (Automations)](#4-الأتمتة-automations)
5. [التكاملات (Integrations)](#5-التكاملات-integrations)
6. [القنوات (Channels)](#6-القنوات-channels)
7. [المحادثات (Inbox)](#7-المحادثات-inbox)
8. [الرسائل (Messaging)](#8-الرسائل-messaging)
9. [الحملات (Campaigns)](#9-الحملات-campaigns)
10. [التحليلات (Analytics)](#10-التحليلات-analytics)
11. [الذكاء الاصطناعي (AI)](#11-الذكاء-الاصطناعي-ai)
12. [رضا العملاء (CSAT)](#12-رضا-العملاء-csat)
13. [الردود السريعة (Quick Replies)](#13-الردود-السريعة-quick-replies)
14. [التصنيفات (Tags)](#14-التصنيفات-tags)
15. [الفوترة (Billing)](#15-الفوترة-billing)
16. [Webhooks](#16-webhooks)

---

## 1. المصادقة (Auth)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/auth/register` | تسجيل حساب جديد |
| POST | `/auth/login` | تسجيل الدخول |
| POST | `/auth/logout` | تسجيل الخروج |
| POST | `/auth/refresh` | تجديد التوكن |
| POST | `/auth/forgot-password` | نسيت كلمة المرور |
| POST | `/auth/reset-password` | إعادة تعيين كلمة المرور |
| POST | `/auth/verify-email` | تأكيد البريد |
| GET | `/auth/me` | معلومات المستخدم الحالي |

---

## 2. القوالب (Templates)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/templates` | قائمة القوالب |
| POST | `/templates` | إنشاء قالب جديد |
| GET | `/templates/:id` | تفاصيل قالب |
| PUT | `/templates/:id` | تحديث قالب |
| DELETE | `/templates/:id` | حذف قالب |
| PATCH | `/templates/:id/toggle` | تفعيل/تعطيل |
| POST | `/templates/:id/duplicate` | نسخ قالب |
| POST | `/templates/:id/test` | اختبار قالب |
| GET | `/templates/categories` | الفئات المتاحة |
| GET | `/templates/variables` | المتغيرات المتاحة |
| GET | `/templates/presets` | القوالب الجاهزة |
| POST | `/templates/whatsapp/submit` | إرسال للموافقة |
| GET | `/templates/whatsapp/status` | حالة الموافقة |
| POST | `/templates/whatsapp/sync` | مزامنة |

---

## 3. العملاء (Contacts/CRM)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/contacts` | قائمة العملاء |
| POST | `/contacts` | إضافة عميل |
| GET | `/contacts/:id` | تفاصيل عميل |
| PUT | `/contacts/:id` | تحديث عميل |
| DELETE | `/contacts/:id` | حذف عميل |
| GET | `/contacts/:id/conversations` | محادثات العميل |
| GET | `/contacts/:id/orders` | طلبات العميل |
| GET | `/contacts/:id/timeline` | سجل النشاطات |
| POST | `/contacts/:id/tags` | إضافة تصنيفات |
| DELETE | `/contacts/:id/tags/:tag` | إزالة تصنيف |
| GET | `/contacts/:id/notes` | ملاحظات العميل |
| POST | `/contacts/:id/notes` | إضافة ملاحظة |
| POST | `/contacts/:id/merge` | دمج عملاء |
| POST | `/contacts/:id/block` | حظر عميل |
| POST | `/contacts/:id/unblock` | إلغاء الحظر |
| GET | `/contacts/stats` | إحصائيات |
| GET | `/contacts/segments` | شرائح العملاء |
| POST | `/contacts/segments` | إنشاء شريحة |
| POST | `/contacts/import` | استيراد |
| GET | `/contacts/export` | تصدير |

---

## 4. الأتمتة (Automations)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/automations` | قائمة الأتمتات |
| POST | `/automations` | إنشاء أتمتة |
| GET | `/automations/:id` | تفاصيل أتمتة |
| PUT | `/automations/:id` | تحديث أتمتة |
| DELETE | `/automations/:id` | حذف أتمتة |
| POST | `/automations/:id/activate` | تفعيل |
| POST | `/automations/:id/deactivate` | تعطيل |
| GET | `/automations/:id/logs` | سجلات التنفيذ |
| GET | `/automations/:id/stats` | إحصائيات |
| GET | `/automations/triggers` | المحفزات المتاحة |
| GET | `/automations/actions` | الإجراءات المتاحة |
| GET | `/automations/presets` | أتمتات جاهزة |
| GET | `/automations/workflows` | قائمة Workflows |
| POST | `/automations/workflows` | إنشاء Workflow |
| GET | `/automations/workflows/:id` | تفاصيل Workflow |
| PUT | `/automations/workflows/:id` | تحديث Workflow |
| DELETE | `/automations/workflows/:id` | حذف Workflow |

---

## 5. التكاملات (Integrations)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/integrations` | التكاملات النشطة |
| GET | `/integrations/available` | التكاملات المتاحة |
| DELETE | `/integrations/:id` | فصل تكامل |
| GET | `/integrations/salla/connect` | ربط سلة |
| GET | `/integrations/salla/callback` | Salla OAuth Callback |
| GET | `/integrations/salla/orders` | طلبات سلة |
| GET | `/integrations/salla/products` | منتجات سلة |
| GET | `/integrations/salla/customers` | عملاء سلة |
| GET | `/integrations/salla/abandoned-carts` | السلات المتروكة |
| GET | `/integrations/zid/connect` | ربط زد |
| GET | `/integrations/zid/callback` | Zid OAuth Callback |
| GET | `/integrations/zid/orders` | طلبات زد |
| GET | `/integrations/zid/products` | منتجات زد |
| POST | `/integrations/shopify/connect` | ربط شوبيفاي |
| POST | `/integrations/woocommerce/connect` | ربط ووكومرس |
| POST | `/integrations/:platform/sync` | مزامنة البيانات |
| GET | `/integrations/:platform/sync-status` | حالة المزامنة |

---

## 6. القنوات (Channels)

### 6.1 WhatsApp

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/channels/whatsapp/connect` | ربط WhatsApp |
| GET | `/channels/whatsapp/status` | حالة الاتصال |
| POST | `/channels/whatsapp/send` | إرسال رسالة |
| POST | `/channels/whatsapp/send-template` | إرسال قالب |
| GET | `/channels/whatsapp/webhook` | Webhook Verify |
| POST | `/channels/whatsapp/webhook` | استقبال Webhook |

### 6.2 Instagram

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/channels/instagram/connect` | ربط Instagram |
| GET | `/channels/instagram/callback` | OAuth Callback |
| GET | `/channels/instagram/status` | حالة الاتصال |
| POST | `/channels/instagram/send` | إرسال رسالة |
| DELETE | `/channels/instagram/disconnect` | فصل الاتصال |

### 6.3 Telegram

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/channels/telegram/connect` | ربط البوت |
| GET | `/channels/telegram/status` | حالة الاتصال |
| POST | `/channels/telegram/send` | إرسال رسالة |
| POST | `/channels/telegram/send-photo` | إرسال صورة |
| POST | `/channels/telegram/webhook/:token` | استقبال Webhook |
| DELETE | `/channels/telegram/disconnect` | فصل الاتصال |

### 6.4 SMS

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/channels/sms/providers` | المزودين المدعومين |
| POST | `/channels/sms/connect` | ربط مزود SMS |
| GET | `/channels/sms/status` | حالة الاتصال |
| GET | `/channels/sms/balance` | الرصيد |
| POST | `/channels/sms/send` | إرسال رسالة |
| POST | `/channels/sms/bulk` | إرسال جماعي |
| POST | `/channels/sms/otp` | إرسال OTP |
| GET | `/channels/sms/reports` | تقارير الإرسال |

### 6.5 Email

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/channels/email/providers` | المزودين المدعومين |
| POST | `/channels/email/connect` | ربط البريد |
| POST | `/channels/email/test` | اختبار الإعدادات |
| GET | `/channels/email/status` | حالة الاتصال |
| POST | `/channels/email/send` | إرسال بريد |
| POST | `/channels/email/bulk` | إرسال جماعي |
| GET | `/channels/email/templates` | قوالب البريد |
| GET | `/channels/email/reports` | تقارير الإرسال |

---

## 7. المحادثات (Inbox)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/inbox/conversations` | قائمة المحادثات |
| GET | `/inbox/conversations/:id` | تفاصيل محادثة |
| POST | `/inbox/conversations/:id/messages` | إرسال رسالة |
| PUT | `/inbox/conversations/:id/assign` | تعيين محادثة |
| PUT | `/inbox/conversations/:id/status` | تغيير الحالة |
| POST | `/inbox/conversations/:id/notes` | إضافة ملاحظة |
| POST | `/inbox/conversations/:id/tags` | إضافة تصنيف |
| POST | `/inbox/conversations/:id/transfer` | تحويل محادثة |
| POST | `/inbox/conversations/bulk-assign` | تعيين جماعي |
| GET | `/inbox/conversations/search` | بحث |
| GET | `/inbox/conversations/unread-count` | عدد غير المقروءة |

---

## 8. الرسائل (Messaging)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | `/messaging/send` | إرسال رسالة |
| POST | `/messaging/send-template` | إرسال قالب |
| POST | `/messaging/send-media` | إرسال وسائط |
| POST | `/messaging/send-interactive` | رسالة تفاعلية |
| POST | `/messaging/broadcast` | بث جماعي |
| GET | `/messaging/:conversationId` | رسائل المحادثة |
| PUT | `/messaging/:id/read` | تعليم كمقروء |
| DELETE | `/messaging/:id` | حذف رسالة |

---

## 9. الحملات (Campaigns)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/campaigns` | قائمة الحملات |
| POST | `/campaigns` | إنشاء حملة |
| GET | `/campaigns/:id` | تفاصيل حملة |
| PUT | `/campaigns/:id` | تحديث حملة |
| DELETE | `/campaigns/:id` | حذف حملة |
| POST | `/campaigns/:id/schedule` | جدولة |
| POST | `/campaigns/:id/send` | إرسال |
| POST | `/campaigns/:id/pause` | إيقاف مؤقت |
| POST | `/campaigns/:id/resume` | استئناف |
| GET | `/campaigns/:id/analytics` | تحليلات |

---

## 10. التحليلات (Analytics)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/analytics/overview` | نظرة عامة |
| GET | `/analytics/conversations` | تحليلات المحادثات |
| GET | `/analytics/messages` | تحليلات الرسائل |
| GET | `/analytics/team-performance` | أداء الفريق |
| GET | `/analytics/response-time` | وقت الاستجابة |
| GET | `/analytics/csat` | رضا العملاء |
| GET | `/analytics/campaigns` | تحليلات الحملات |
| GET | `/analytics/channels` | تحليلات القنوات |
| GET | `/analytics/chatbot` | تحليلات البوت |
| GET | `/analytics/real-time` | بيانات فورية |
| POST | `/analytics/custom-report` | تقرير مخصص |
| GET | `/analytics/export` | تصدير |

---

## 11. الذكاء الاصطناعي (AI)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/ai/agents` | قائمة الوكلاء |
| POST | `/ai/agents` | إنشاء وكيل |
| GET | `/ai/agents/:id` | تفاصيل وكيل |
| PUT | `/ai/agents/:id` | تحديث وكيل |
| POST | `/ai/agents/:id/train` | تدريب |
| GET | `/ai/agents/:id/analytics` | تحليلات |
| POST | `/ai/auto-reply` | رد تلقائي |
| POST | `/ai/sentiment-analysis` | تحليل المشاعر |
| POST | `/ai/summarize` | تلخيص |
| POST | `/ai/suggest-reply` | اقتراح رد |
| POST | `/ai/translate` | ترجمة |

---

## 12. رضا العملاء (CSAT)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/csat/settings` | إعدادات التقييم |
| PUT | `/csat/settings` | تحديث الإعدادات |
| GET | `/csat/types` | أنواع التقييم |
| GET | `/csat/surveys` | قائمة التقييمات |
| GET | `/csat/surveys/:id` | تفاصيل تقييم |
| POST | `/csat/surveys/:token/submit` | إرسال تقييم (عام) |
| GET | `/csat/analytics` | تحليلات |
| GET | `/csat/analytics/agents` | تقييمات الوكلاء |
| GET | `/csat/analytics/trends` | الاتجاهات |
| GET | `/csat/export` | تصدير |

---

## 13. الردود السريعة (Quick Replies)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/quick-replies` | قائمة الردود |
| POST | `/quick-replies` | إنشاء رد |
| GET | `/quick-replies/:id` | تفاصيل رد |
| PUT | `/quick-replies/:id` | تحديث رد |
| DELETE | `/quick-replies/:id` | حذف رد |
| GET | `/quick-replies/search` | بحث سريع |
| GET | `/quick-replies/categories` | الفئات |
| POST | `/quick-replies/categories` | إنشاء فئة |
| POST | `/quick-replies/:id/use` | تسجيل استخدام |
| GET | `/quick-replies/stats/popular` | الأكثر استخداماً |

---

## 14. التصنيفات (Tags)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/tags` | قائمة التصنيفات |
| POST | `/tags` | إنشاء تصنيف |
| GET | `/tags/:id` | تفاصيل تصنيف |
| PUT | `/tags/:id` | تحديث تصنيف |
| DELETE | `/tags/:id` | حذف تصنيف |
| GET | `/tags/stats` | إحصائيات الاستخدام |
| POST | `/tags/bulk` | إنشاء متعدد |
| DELETE | `/tags/bulk` | حذف متعدد |
| POST | `/tags/:id/merge` | دمج تصنيفات |

---

## 15. الفوترة (Billing)

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/billing/subscription` | الاشتراك الحالي |
| PUT | `/billing/subscription` | تحديث الاشتراك |
| GET | `/billing/invoices` | الفواتير |
| GET | `/billing/usage` | الاستخدام |
| GET | `/billing/plans` | الباقات المتاحة |
| POST | `/billing/payment-method` | إضافة طريقة دفع |

---

## 16. Webhooks

| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET | `/webhooks` | قائمة Webhooks |
| POST | `/webhooks` | إنشاء Webhook |
| GET | `/webhooks/:id` | تفاصيل Webhook |
| PUT | `/webhooks/:id` | تحديث Webhook |
| DELETE | `/webhooks/:id` | حذف Webhook |
| GET | `/webhooks/:id/logs` | سجلات الإرسال |
| POST | `/webhooks/:id/test` | اختبار |

---

## 📊 إجمالي الـ Endpoints

| القسم | عدد الـ Endpoints |
|-------|------------------|
| Auth | 8 |
| Templates | 14 |
| Contacts/CRM | 20 |
| Automations | 17 |
| Integrations | 17 |
| Channels | 35 |
| Inbox | 11 |
| Messaging | 8 |
| Campaigns | 10 |
| Analytics | 12 |
| AI | 11 |
| CSAT | 10 |
| Quick Replies | 10 |
| Tags | 9 |
| Billing | 6 |
| Webhooks | 7 |
| **المجموع** | **~195 Endpoint** |

---

## 🔐 المصادقة

جميع الـ Endpoints (عدا المحددة) تتطلب JWT Token:

```
Authorization: Bearer <your_jwt_token>
```

---

## 📝 ملاحظات

- جميع الردود بصيغة JSON
- التاريخ بصيغة ISO 8601
- الأخطاء تُرجع بصيغة موحدة
- دعم كامل للغة العربية و RTL
- Rate Limiting: 1000 طلب/دقيقة

---

## 🆘 الدعم

- البريد: support@rafiq.ai
- الوثائق: https://docs.rafiq.ai
- حالة الخدمة: https://status.rafiq.ai
