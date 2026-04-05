import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../services/audit.service';
import { AuditAction } from '../entities/audit-log.entity';

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              Tenant Audit Interceptor — Auto-capture merchant actions          ║
 * ║                                                                               ║
 * ║  Intercepts tenant API calls (POST/PUT/DELETE) and logs them automatically    ║
 * ║  Extracts actor info from JWT, maps routes to audit actions                   ║
 * ║  Fire-and-forget — never blocks the response                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Route → Action mapping
// ═══════════════════════════════════════════════════════════════════════════════

interface RouteMapping {
  action: AuditAction | string;
  targetType?: string;
  label: string;
}

const ROUTE_MAP: Record<string, RouteMapping> = {
  // ── Auth ──
  'POST /auth/login':           { action: AuditAction.TENANT_LOGIN,            targetType: 'auth',     label: 'تسجيل دخول' },
  'POST /auth/register':        { action: AuditAction.TENANT_REGISTER,         targetType: 'auth',     label: 'تسجيل حساب جديد' },
  'POST /auth/logout':          { action: AuditAction.TENANT_LOGOUT,           targetType: 'auth',     label: 'تسجيل خروج' },
  'POST /auth/salla/callback':  { action: AuditAction.TENANT_SALLA_LOGIN,      targetType: 'auth',     label: 'دخول عبر سلة' },
  'POST /auth/zid/callback':    { action: AuditAction.TENANT_ZID_LOGIN,        targetType: 'auth',     label: 'دخول عبر زد' },
  'POST /auth/change-password': { action: AuditAction.TENANT_PASSWORD_CHANGED, targetType: 'auth',     label: 'تغيير كلمة المرور' },
  'POST /auth/set-password':    { action: AuditAction.TENANT_PASSWORD_CHANGED, targetType: 'auth',     label: 'تعيين كلمة المرور' },

  // ── AI ──
  'PUT /ai/settings':           { action: AuditAction.TENANT_AI_SETTINGS_UPDATED, targetType: 'ai',    label: 'تحديث إعدادات البوت' },
  'POST /ai/knowledge':         { action: AuditAction.TENANT_AI_KNOWLEDGE_ADDED,  targetType: 'ai',    label: 'إضافة معلومة للمكتبة' },
  'DELETE /ai/knowledge':       { action: AuditAction.TENANT_AI_KNOWLEDGE_DELETED, targetType: 'ai',   label: 'حذف معلومة من المكتبة' },

  // ── Templates ──
  'POST /templates':            { action: AuditAction.TENANT_TEMPLATE_ACTIVATED,   targetType: 'template', label: 'تفعيل قالب' },
  'PUT /templates':             { action: AuditAction.TENANT_TEMPLATE_UPDATED,     targetType: 'template', label: 'تحديث قالب' },
  'DELETE /templates':          { action: AuditAction.TENANT_TEMPLATE_DEACTIVATED, targetType: 'template', label: 'إيقاف قالب' },

  // ── Channels ──
  'POST /channels/whatsapp/qr': { action: AuditAction.TENANT_CHANNEL_CONNECTED,   targetType: 'channel', label: 'ربط قناة واتساب' },
  'DELETE /channels':           { action: AuditAction.TENANT_CHANNEL_DISCONNECTED, targetType: 'channel', label: 'فصل قناة' },

  // ── Stores ──
  'POST /stores':               { action: AuditAction.TENANT_STORE_CONNECTED,      targetType: 'store',   label: 'ربط متجر' },
  'DELETE /stores':             { action: AuditAction.TENANT_STORE_DISCONNECTED,   targetType: 'store',   label: 'فصل متجر' },

  // ── Campaigns ──
  'POST /campaigns':            { action: AuditAction.TENANT_CAMPAIGN_CREATED,     targetType: 'campaign', label: 'إنشاء حملة' },
  'POST /campaigns/send':       { action: AuditAction.TENANT_CAMPAIGN_SENT,        targetType: 'campaign', label: 'إرسال حملة' },

  // ── OTP ──
  'POST /otp-relay/configs':    { action: AuditAction.TENANT_OTP_SERVICE_CREATED,  targetType: 'otp',     label: 'إنشاء خدمة OTP' },
  'PUT /otp-relay/configs':     { action: AuditAction.TENANT_OTP_SERVICE_UPDATED,  targetType: 'otp',     label: 'تحديث خدمة OTP' },

  // ── Settings ──
  'PUT /settings':              { action: AuditAction.TENANT_SETTINGS_UPDATED,     targetType: 'settings', label: 'تحديث الإعدادات' },

  // ── Staff ──
  'POST /users/invite':         { action: AuditAction.TENANT_STAFF_ADDED,          targetType: 'staff',   label: 'دعوة موظف' },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Interceptor
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class TenantAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('TenantAudit');

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, headers } = request;

    // Only intercept write operations
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    // Build route key: "POST /ai/settings" (strip /api prefix and params)
    const cleanPath = (url || '')
      .replace(/^\/api/, '')
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '') // strip UUIDs
      .replace(/\/\d+/g, '')           // strip numeric IDs
      .replace(/\?.*$/, '')            // strip query params
      .replace(/\/+$/, '');            // strip trailing slashes

    const routeKey = `${method} ${cleanPath}`;
    const mapping = ROUTE_MAP[routeKey];

    if (!mapping) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // Fire-and-forget — don't block response
          this.logAction(request, mapping, responseData, startTime).catch(() => {});
        },
        error: () => {
          // Don't log failed requests
        },
      }),
    );
  }

  private async logAction(
    request: any,
    mapping: RouteMapping,
    responseData: any,
    startTime: number,
  ): Promise<void> {
    const { user, headers, ip, body } = request;

    // Extract actor info from JWT or response
    const actorId = user?.sub || user?.id || responseData?.user?.id || 'unknown';
    const actorEmail = user?.email || responseData?.user?.email || 'unknown';
    const tenantId = user?.tenantId || responseData?.user?.tenantId || '';

    // Skip if no identifiable actor
    if (actorId === 'unknown' && actorEmail === 'unknown') return;

    // Extract target ID from URL or response
    const urlParts = (request.url || '').split('/').filter(Boolean);
    const uuidMatch = (request.url || '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const targetId = uuidMatch?.[1] || responseData?.id || undefined;

    // Build metadata — capture key info without sensitive data
    const metadata: Record<string, unknown> = {
      label: mapping.label,
      responseTime: Date.now() - startTime,
    };

    // ── AI-specific metadata ──
    if (mapping.action === AuditAction.TENANT_AI_SETTINGS_UPDATED && body) {
      if (body.enabled !== undefined) {
        metadata.botEnabled = body.enabled;
        // Override action for enable/disable
        if (body.enabled === true) {
          (mapping as any).action = AuditAction.TENANT_AI_ENABLED;
          metadata.label = 'تفعيل البوت';
        } else if (body.enabled === false) {
          (mapping as any).action = AuditAction.TENANT_AI_DISABLED;
          metadata.label = 'تعطيل البوت';
        }
      }
      if (body.storeName) metadata.storeName = body.storeName;
      if (body.model) metadata.model = body.model;
    }

    // ── Template metadata ──
    if (mapping.targetType === 'template' && body) {
      if (body.name) metadata.templateName = body.name;
      if (body.triggerEvent) metadata.triggerEvent = body.triggerEvent;
    }

    // ── Store metadata ──
    if (mapping.targetType === 'store') {
      if (responseData?.platform) metadata.platform = responseData.platform;
      if (responseData?.name) metadata.storeName = responseData.name;
    }

    // ── IP & User-Agent ──
    const ipAddress =
      headers?.['x-forwarded-for']?.split(',')?.[0]?.trim() ||
      headers?.['x-real-ip'] ||
      ip || 'unknown';

    const storeName =
      headers?.['x-store-name'] as string ||
      (responseData?.storeName as string) ||
      undefined;

    await this.auditService.logTenant({
      actorId,
      actorEmail,
      actorRole: user?.role || 'tenant',
      tenantId,
      storeName,
      action: mapping.action,
      targetType: mapping.targetType,
      targetId,
      metadata,
      ipAddress,
      userAgent: headers?.['user-agent'],
    });
  }
}
