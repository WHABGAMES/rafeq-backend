/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Request Logger Middleware                  ║
 * ║                                                                                ║
 * ║  📌 Middleware لتسجيل كل طلب HTTP يصل للتطبيق                                  ║
 * ║                                                                                ║
 * ║  🤔 ما هو Middleware؟                                                          ║
 * ║     كود يُنفذ قبل وصول الطلب للـ Controller                                    ║
 * ║     يمكنه تعديل الطلب/الاستجابة أو رفض الطلب                                   ║
 * ║                                                                                ║
 * ║  ترتيب التنفيذ:                                                                ║
 * ║     Request → Middleware → Guards → Interceptors → Pipes → Controller         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// Request Logger Middleware
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * 📝 RequestLoggerMiddleware
 *
 * يسجل معلومات عن كل طلب HTTP:
 * - Request ID فريد لتتبع الطلب
 * - HTTP Method (GET, POST, etc.)
 * - URL المطلوب
 * - عنوان IP للمستخدم
 * - وقت الاستجابة
 * - Status Code
 *
 * @Injectable() - يسمح لـ NestJS بإدارة الـ lifecycle
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  // ─────────────────────────────────────────────────────────────────────────────
  // Logger Instance
  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * Logger من NestJS:
   * - يضيف timestamp تلقائياً
   * - يدعم ألوان في الـ console
   * - يمكن توجيهه لملفات أو خدمات خارجية
   *
   * 'HTTP' = اسم السياق (Context)
   * يظهر في الـ log: [HTTP] GET /api/users...
   */
  private readonly logger = new Logger('HTTP');

  // ─────────────────────────────────────────────────────────────────────────────
  // use() - الدالة الرئيسية للـ Middleware
  // ─────────────────────────────────────────────────────────────────────────────
  /**
   * @param request - كائن الطلب من Express
   * @param response - كائن الاستجابة من Express
   * @param next - دالة للانتقال للـ middleware التالي
   *
   * يجب استدعاء next() للسماح للطلب بالمتابعة
   * إذا لم تستدعِ next(): الطلب يتوقف هنا (مفيد للـ Auth)
   */
  use(request: Request, response: Response, next: NextFunction): void {
    // ═══════════════════════════════════════════════════════════════════════════
    // 1️⃣ توليد Request ID
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * 🔑 Request ID - معرف فريد لكل طلب
     *
     * الفوائد:
     * ─────────
     * 1. تتبع الطلب عبر الـ logs
     * 2. ربط الأخطاء بالطلب المسبب
     * 3. debugging في الـ Production
     * 4. تحليل الأداء
     *
     * الأولوية:
     * 1. X-Request-ID من الـ headers (من Load Balancer أو API Gateway)
     * 2. توليد UUID جديد
     *
     * مثال الاستخدام:
     * ────────────────
     * في الـ Service:
     * const requestId = request.headers['x-request-id'];
     * this.logger.error(`[${requestId}] Failed to process...`);
     */
    const requestId =
      (request.headers['x-request-id'] as string) || randomUUID();

    // إضافة Request ID للـ headers (للاستخدام لاحقاً)
    request.headers['x-request-id'] = requestId;

    // إرسال Request ID في الاستجابة (مفيد للـ debugging)
    response.setHeader('X-Request-ID', requestId);

    // ═══════════════════════════════════════════════════════════════════════════
    // 2️⃣ استخراج معلومات الطلب
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * method: GET, POST, PUT, PATCH, DELETE
     * originalUrl: المسار الكامل مع query string
     * ip: عنوان IP للمستخدم
     */
    const { method, originalUrl } = request;

    /**
     * 🌐 استخراج IP الحقيقي
     *
     * في Production خلف Load Balancer:
     * - request.ip قد يكون IP الـ Load Balancer
     * - X-Forwarded-For يحتوي IP الحقيقي
     *
     * X-Forwarded-For format:
     * "client, proxy1, proxy2"
     * نأخذ الأول (client)
     *
     * X-Real-IP: بعض الـ proxies تستخدمه
     */
    const clientIp = this.getClientIp(request);

    /**
     * 📱 User Agent - معلومات المتصفح/الجهاز
     *
     * مثال:
     * "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0) AppleWebKit/605.1.15"
     *
     * مفيد لـ:
     * - تحليل الأجهزة
     * - اكتشاف البوتات
     * - تحسين التجربة
     */
    // const _userAgent = request.headers['user-agent'] || 'unknown';

    /**
     * 👤 Tenant ID - لتطبيقات Multi-tenant
     *
     * يُرسل في header مخصص من الـ Frontend
     * يُستخدم لفلترة البيانات حسب العميل
     */
    const tenantId = request.headers['x-tenant-id'] as string;

    // ═══════════════════════════════════════════════════════════════════════════
    // 3️⃣ تسجيل بداية الطلب
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * ⏱️ قياس وقت الاستجابة
     *
     * Date.now() = عدد الـ milliseconds منذ 1970
     * نطرح وقت البداية من وقت النهاية
     */
    const startTime = Date.now();

    // تسجيل الطلب الوارد
    this.logger.log(
      `→ ${method} ${originalUrl} | ` +
        `IP: ${clientIp} | ` +
        `ReqID: ${requestId.substring(0, 8)}...` +
        (tenantId ? ` | Tenant: ${tenantId}` : ''),
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 4️⃣ تسجيل نهاية الطلب
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * 🔄 Event Listener على 'finish'
     *
     * response.on('finish', callback):
     * يُنفذ بعد إرسال الاستجابة بالكامل
     *
     * لماذا نستخدمه؟
     * - للحصول على status code النهائي
     * - قياس الوقت الكامل للمعالجة
     * - تسجيل حجم الاستجابة
     *
     * بدائل:
     * - 'close': بعد إغلاق الاتصال
     * - 'error': عند حدوث خطأ في الإرسال
     */
    response.on('finish', () => {
      const { statusCode } = response;
      const duration = Date.now() - startTime;

      /**
       * 📊 Content-Length - حجم الاستجابة بالـ bytes
       *
       * قد لا يكون موجوداً إذا:
       * - Chunked transfer encoding
       * - Streaming response
       */
      const contentLength = response.get('content-length') || '0';

      /**
       * 🎨 تلوين حسب Status Code
       *
       * 2xx: نجاح (أخضر)
       * 3xx: إعادة توجيه (أزرق)
       * 4xx: خطأ المستخدم (أصفر)
       * 5xx: خطأ الخادم (أحمر)
       */
      const logMethod = this.getLogMethod(statusCode);
      const statusEmoji = this.getStatusEmoji(statusCode);

      // تسجيل اكتمال الطلب
      this.logger[logMethod](
        `${statusEmoji} ${method} ${originalUrl} | ` +
          `${statusCode} | ` +
          `${duration}ms | ` +
          `${this.formatBytes(parseInt(contentLength))} | ` +
          `ReqID: ${requestId.substring(0, 8)}...`,
      );

      // ═══════════════════════════════════════════════════════════════════════════
      // 5️⃣ تحذيرات الأداء
      // ═══════════════════════════════════════════════════════════════════════════
      /**
       * ⚠️ Slow Request Warning
       *
       * إذا استغرق الطلب أكثر من 3 ثواني:
       * - تسجيل تحذير
       * - مفيد لاكتشاف مشاكل الأداء
       *
       * الحدود المقترحة:
       * - API endpoints: 3 ثواني
       * - File uploads: 30 ثانية
       * - Reports: 10 ثواني
       */
      if (duration > 3000) {
        this.logger.warn(
          `🐌 Slow request detected: ${method} ${originalUrl} took ${duration}ms | ` +
            `ReqID: ${requestId}`,
        );
      }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 6️⃣ المتابعة للـ Middleware التالي
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * ⚡ next() - ضروري جداً!
     *
     * بدونه: الطلب يتوقف هنا ولا يصل للـ Controller
     * معه: الطلب يتابع للـ middleware/guard/controller التالي
     *
     * يمكن عدم استدعائه في حالات:
     * - رفض الطلب (Auth failed)
     * - إرسال استجابة مباشرة
     */
    next();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * 🌐 استخراج IP الحقيقي للمستخدم
   *
   * يأخذ بالاعتبار:
   * 1. X-Forwarded-For (standard)
   * 2. X-Real-IP (Nginx)
   * 3. CF-Connecting-IP (Cloudflare)
   * 4. request.ip (fallback)
   */
  private getClientIp(request: Request): string {
    // Cloudflare
    const cfIp = request.headers['cf-connecting-ip'] as string;
    if (cfIp) return cfIp;

    // Standard proxy header
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      // قد يكون string أو array
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return ips.trim();
    }

    // Nginx proxy header
    const realIp = request.headers['x-real-ip'] as string;
    if (realIp) return realIp;

    // Direct connection
    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  /**
   * 📊 اختيار مستوى الـ Log حسب Status Code
   */
  private getLogMethod(statusCode: number): 'log' | 'warn' | 'error' {
    if (statusCode >= 500) return 'error'; // Server errors
    if (statusCode >= 400) return 'warn'; // Client errors
    return 'log'; // Success & redirects
  }

  /**
   * 🎨 Emoji حسب Status Code
   */
  private getStatusEmoji(statusCode: number): string {
    if (statusCode >= 500) return '❌'; // Server error
    if (statusCode >= 400) return '⚠️'; // Client error
    if (statusCode >= 300) return '↪️'; // Redirect
    if (statusCode >= 200) return '✅'; // Success
    return '🔵'; // Informational
  }

  /**
   * 📏 تنسيق حجم الملف
   *
   * bytes → KB, MB, GB
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// كيفية الاستخدام
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * 📚 تطبيق الـ Middleware في AppModule
 *
 * import { MiddlewareConsumer, NestModule } from '@nestjs/common';
 * import { RequestLoggerMiddleware } from '@common/middleware/request-logger.middleware';
 *
 * @Module({ ... })
 * export class AppModule implements NestModule {
 *   configure(consumer: MiddlewareConsumer) {
 *     consumer
 *       .apply(RequestLoggerMiddleware)
 *       .forRoutes('*'); // على كل المسارات
 *
 *     // أو على مسارات محددة:
 *     // .forRoutes('users', 'auth')
 *
 *     // أو استثناء مسارات:
 *     // .exclude('health')
 *     // .forRoutes('*')
 *   }
 * }
 *
 * مثال الناتج في Console:
 * ─────────────────────────
 * [HTTP] → GET /api/users | IP: 192.168.1.1 | ReqID: a1b2c3d4...
 * [HTTP] ✅ GET /api/users | 200 | 45ms | 2.5 KB | ReqID: a1b2c3d4...
 *
 * [HTTP] → POST /api/auth/login | IP: 192.168.1.1 | ReqID: e5f6g7h8...
 * [HTTP] ⚠️ POST /api/auth/login | 401 | 12ms | 156 B | ReqID: e5f6g7h8...
 *
 * [HTTP] → GET /api/reports/sales | IP: 192.168.1.1 | ReqID: i9j0k1l2...
 * [HTTP] 🐌 Slow request detected: GET /api/reports/sales took 5234ms
 * [HTTP] ✅ GET /api/reports/sales | 200 | 5234ms | 1.2 MB | ReqID: i9j0k1l2...
 */
