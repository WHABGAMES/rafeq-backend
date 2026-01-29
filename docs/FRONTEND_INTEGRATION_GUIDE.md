# 🔗 دليل الربط مع الواجهة (Frontend Integration Guide)

## 📡 الـ API Base URL

```
Production: https://sea-turtle-app-neix4.ondigitalocean.app
Development: http://localhost:3000
```

---

## 🔐 Authentication

### Headers المطلوبة

```javascript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer <token>',  // بعد تسجيل الدخول
  'X-Tenant-ID': '<tenant-id>',       // اختياري - Multi-tenancy
  'X-Request-ID': '<uuid>',           // اختياري - للتتبع
};
```

### تسجيل الدخول

```javascript
// POST /api/v1/auth/login
const response = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});

// الرد:
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "اسم المستخدم"
    }
  },
  "meta": {
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

---

## ✅ شكل الردود الموحد

### رد النجاح (Success Response)

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "requestId": "uuid-request-id",
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 100,
      "totalPages": 10,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### رد الخطأ (Error Response)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "البيانات غير صحيحة",
    "details": [
      "البريد الإلكتروني مطلوب",
      "كلمة المرور قصيرة جداً"
    ],
    "timestamp": "2024-01-15T10:30:00.000Z",
    "path": "/api/v1/auth/login",
    "requestId": "uuid-request-id"
  }
}
```

---

## 📋 أكواد الأخطاء (Error Codes)

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `UNAUTHORIZED` | غير مصرح | 401 |
| `INVALID_CREDENTIALS` | بيانات الدخول خاطئة | 401 |
| `TOKEN_EXPIRED` | انتهت صلاحية التوكن | 401 |
| `TOKEN_INVALID` | التوكن غير صالح | 401 |
| `VALIDATION_ERROR` | خطأ في التحقق | 400 |
| `NOT_FOUND` | غير موجود | 404 |
| `ALREADY_EXISTS` | موجود مسبقاً | 409 |
| `FORBIDDEN` | غير مسموح | 403 |
| `TOO_MANY_REQUESTS` | طلبات كثيرة | 429 |
| `INTERNAL_ERROR` | خطأ داخلي | 500 |
| `SUBSCRIPTION_EXPIRED` | انتهى الاشتراك | 402 |
| `QUOTA_EXCEEDED` | تجاوز الحد | 402 |

---

## 🔗 الـ Endpoints الرئيسية

### Auth (المصادقة)
```
POST   /api/v1/auth/login           → تسجيل الدخول
POST   /api/v1/auth/register        → إنشاء حساب
POST   /api/v1/auth/refresh         → تجديد التوكن
POST   /api/v1/auth/logout          → تسجيل الخروج
GET    /api/v1/auth/me              → بيانات المستخدم
```

### Templates (القوالب)
```
GET    /api/v1/templates            → قائمة القوالب
POST   /api/v1/templates            → إنشاء قالب
GET    /api/v1/templates/:id        → تفاصيل قالب
PUT    /api/v1/templates/:id        → تحديث قالب
DELETE /api/v1/templates/:id        → حذف قالب
PATCH  /api/v1/templates/:id/toggle → تفعيل/تعطيل
```

### AI (الذكاء الاصطناعي)
```
GET    /api/v1/ai/settings          → إعدادات البوت
PUT    /api/v1/ai/settings          → تحديث الإعدادات
GET    /api/v1/ai/knowledge         → قاعدة المعرفة
POST   /api/v1/ai/knowledge         → إضافة معرفة
POST   /api/v1/ai/train             → تدريب البوت
GET    /api/v1/ai/analytics         → تحليلات البوت
POST   /api/v1/ai/respond           → إنشاء رد
POST   /api/v1/ai/test              → اختبار
```

### Integrations (التكاملات)
```
GET    /api/v1/integrations/available       → التكاملات المتاحة
GET    /api/v1/integrations                 → التكاملات النشطة
GET    /api/v1/integrations/salla/connect   → ربط سلة
GET    /api/v1/integrations/zid/connect     → ربط زد
POST   /api/v1/integrations/shopify/connect → ربط شوبيفاي
```

### Settings (الإعدادات)
```
GET    /api/v1/settings                     → جميع الإعدادات
GET    /api/v1/settings/general             → الإعدادات العامة
PUT    /api/v1/settings/general             → تحديث
GET    /api/v1/settings/notifications       → إعدادات الإشعارات
GET    /api/v1/settings/working-hours       → ساعات العمل
GET    /api/v1/settings/auto-replies        → الردود التلقائية
```

### Inbox (المحادثات)
```
GET    /api/v1/inbox                → قائمة المحادثات
GET    /api/v1/inbox/stats          → إحصائيات
GET    /api/v1/inbox/:id            → تفاصيل محادثة
POST   /api/v1/inbox/:id/assign     → تعيين
PATCH  /api/v1/inbox/:id/status     → تغيير الحالة
```

### Contacts (العملاء)
```
GET    /api/v1/contacts             → قائمة العملاء
POST   /api/v1/contacts             → إضافة عميل
GET    /api/v1/contacts/:id         → تفاصيل
PUT    /api/v1/contacts/:id         → تحديث
DELETE /api/v1/contacts/:id         → حذف
GET    /api/v1/contacts/:id/timeline → سجل النشاطات
```

---

## 📚 Swagger Documentation

```
https://sea-turtle-app-neix4.ondigitalocean.app/api/docs
```

---

## 🔄 مثال كامل في React/Next.js

```typescript
// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://sea-turtle-app-neix4.ondigitalocean.app';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string[];
  };
  meta?: {
    timestamp: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = localStorage.getItem('accessToken');
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  const data = await response.json();
  
  if (!data.success) {
    // Handle error
    throw new Error(data.error?.message || 'Unknown error');
  }
  
  return data;
}

// استخدام:
const { data: templates } = await apiRequest('/api/v1/templates');
```

---

## ✅ الملفات المضافة للربط

| الملف | الوظيفة |
|-------|---------|
| `src/common/filters/http-exception.filter.ts` | توحيد شكل الأخطاء |
| `src/common/interceptors/transform-response.interceptor.ts` | توحيد شكل الردود |
| `src/common/dto/api-response.dto.ts` | DTOs للتوثيق |

---

**تاريخ التحديث:** 2024-01-29
