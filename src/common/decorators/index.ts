/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Custom Decorators                                ║
 * ║                                                                                ║
 * ║  📌 Decorators مخصصة لتسهيل الوصول للبيانات الشائعة                             ║
 * ║                                                                                ║
 * ║  ✅ v2: إضافة @RequirePermission() للتحقق من صلاحيات الموظفين                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

/**
 * 📌 Permission System Constants
 * مُعرَّفة هنا وفي permission.guard.ts بنفس القيم
 * بدون import بينهم (no cross-dependency)
 */
export const PERMISSION_KEY = 'required_permission';

export type PermissionType =
  | 'conversations'
  | 'contacts'
  | 'templates'
  | 'campaigns'
  | 'automations'
  | 'analytics'
  | 'settings'
  | 'quickReplies'
  | 'ai';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 @CurrentUser() - الحصول على المستخدم الحالي
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * يستخرج المستخدم من الـ Request بعد JWT validation
 * 
 * @example
 * ```typescript
 * @Get('profile')
 * getProfile(@CurrentUser() user: User) {
 *   return user;
 * }
 * 
 * // أو للحصول على خاصية محددة:
 * @Get('profile')
 * getProfile(@CurrentUser('id') userId: string) {
 *   return userId;
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // إذا طُلبت خاصية محددة
    if (data) {
      return user?.[data];
    }

    return user;
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 @CurrentTenant() - الحصول على معرف المستأجر الحالي
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * يستخرج tenant ID من الـ JWT token أو الـ Request
 * 
 * @example
 * ```typescript
 * @Get('data')
 * getData(@CurrentTenant() tenantId: string) {
 *   return this.service.findAll(tenantId);
 * }
 * ```
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    
    // أولاً: من الـ JWT token (user.tenantId)
    if (request.user?.tenantId) {
      return request.user.tenantId;
    }

    // ثانياً: من الـ header (X-Tenant-ID)
    const headerTenantId = request.headers['x-tenant-id'];
    if (headerTenantId) {
      return headerTenantId;
    }

    // ثالثاً: من الـ request object (middleware قد يضيفه)
    if (request.tenantId) {
      return request.tenantId;
    }

    return null;
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 @Public() - تعليم Endpoint كـ public (لا يحتاج مصادقة)
// ═══════════════════════════════════════════════════════════════════════════════

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 @Roles() - تحديد الأدوار المسموحة
// ═══════════════════════════════════════════════════════════════════════════════

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 @RequirePermission() - التحقق من صلاحية الموظف ✅ NEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * يتحقق من أن الموظف يملك الصلاحية المطلوبة
 * يُستخدم مع PermissionGuard
 * 
 * Owner → دائماً مسموح (لا يحتاج فحص)
 * غيره → يتحقق من preferences.permissions
 * 
 * @example
 * ```typescript
 * // على مستوى الـ Controller (كل الـ routes)
 * @Controller('templates')
 * @UseGuards(JwtAuthGuard, PermissionGuard)
 * @RequirePermission('templates')
 * export class TemplatesController { }
 * 
 * // أو على مستوى method واحد
 * @Post()
 * @RequirePermission('campaigns')
 * createCampaign() { }
 * ```
 * 
 * الصلاحيات المتاحة:
 * - conversations: المحادثات
 * - contacts: العملاء
 * - templates: القوالب
 * - campaigns: الحملات
 * - automations: الأتمتة
 * - analytics: التحليلات
 * - settings: الإعدادات
 * - quickReplies: الردود السريعة
 * - ai: الذكاء الاصطناعي
 */
export const RequirePermission = (permission: PermissionType) =>
  SetMetadata(PERMISSION_KEY, permission);

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 @ApiPaginatedResponse() - توثيق Response مع Pagination
// ═══════════════════════════════════════════════════════════════════════════════

import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description: 'Successfully received paginated response',
      schema: {
        allOf: [
          {
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                properties: {
                  items: {
                    type: 'array',
                    items: { $ref: getSchemaPath(model) },
                  },
                  meta: {
                    type: 'object',
                    properties: {
                      total: { type: 'number', example: 100 },
                      page: { type: 'number', example: 1 },
                      limit: { type: 'number', example: 20 },
                      totalPages: { type: 'number', example: 5 },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    }),
  );
