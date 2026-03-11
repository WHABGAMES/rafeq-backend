/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Admin Subscription Controller                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

// ✅ Guards - matching actual exports from admin.guards.ts
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { CurrentAdmin, AdminIp } from '../decorators/current-admin.decorator';

// ✅ Entities - matching actual exports
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';

// ✅ Audit - matching actual AuditLogCreateInput interface
import { AuditService } from '../services/audit.service';

// ✅ Subscription service
import {
  SubscriptionManagementService,
  PlanTier,
} from '../../billing/services/subscription-management.service';

@Controller('admin/subscriptions')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@ApiTags('Admin - Subscriptions')
export class AdminSubscriptionsController {
  constructor(
    private readonly subscriptionService: SubscriptionManagementService,
    private readonly auditService: AuditService,
  ) {}

  // ─── GET /admin/subscriptions ────────────────────────────────────────────

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'قائمة اشتراكات جميع التجار' })
  async listSubscriptions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('plan') plan?: PlanTier,
    @Query('search') search?: string,
  ) {
    return this.subscriptionService.listAllSubscriptions({
      page: page || 1,
      limit: limit || 50,
      plan,
      search,
    });
  }

  // ─── GET /admin/subscriptions/:tenantId ──────────────────────────────────

  @Get(':tenantId')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'تفاصيل اشتراك تاجر معين' })
  async getSubscription(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.subscriptionService.getSubscriptionInfo(tenantId);
  }

  // ─── POST /admin/subscriptions/set-plan ──────────────────────────────────

  @Post('set-plan')
  @RequirePermissions(PERMISSIONS.USERS_SUSPEND) // أقرب صلاحية لتعديل بيانات التاجر
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تعيين أو تغيير باقة تاجر يدوياً' })
  async setPlan(
    @Body() body: {
      tenantId: string;
      plan: string;
      reason?: string;
      durationAmount?: number;
      durationUnit?: 'days' | 'weeks' | 'months';
    },
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    const validPlans = Object.values(PlanTier);
    if (!validPlans.includes(body.plan as PlanTier)) {
      throw new BadRequestException(
        `الباقة غير صحيحة. المتاح: ${validPlans.join(', ')}`,
      );
    }
    if (!body.tenantId) {
      throw new BadRequestException('معرف التاجر مطلوب');
    }

    const duration = body.durationAmount && body.durationUnit
      ? { amount: body.durationAmount, unit: body.durationUnit }
      : undefined;

    const result = await this.subscriptionService.adminSetPlan(
      body.tenantId,
      body.plan as PlanTier,
      admin.id,
      body.reason,
      duration,
    );

    // ✅ AuditService.log() — يأخذ actor: AdminUser (كائن كامل)
    await this.auditService.log({
      actor: admin,
      action: 'subscription.set_plan',
      targetType: 'tenant',
      targetId: body.tenantId,
      metadata: {
        plan: body.plan,
        reason: body.reason || '',
        durationAmount: body.durationAmount,
        durationUnit: body.durationUnit,
      },
      ipAddress: ip,
    });

    const planLabel = body.plan === 'none' ? 'بدون اشتراك'
      : body.plan === 'professional' ? 'الاحترافية' : 'الأساسية';

    return {
      success: true,
      message: `تم تعيين الباقة ${planLabel} بنجاح`,
      subscription: result,
    };
  }

  // ─── POST /admin/subscriptions/reset-all-usage ───────────────────────
  // ✅ FIX: يجب أن يكون قبل reset-usage/:tenantId لمنع تعارض المسارات

  @Post('reset-all-usage')
  @RequirePermissions(PERMISSIONS.USERS_SUSPEND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إعادة تعيين الاستخدام الشهري لكل التجار' })
  async resetAllUsage(
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    const count = await this.subscriptionService.resetAllMonthlyUsage();

    await this.auditService.log({
      actor: admin,
      action: 'subscription.reset_all_usage',
      targetType: 'system',
      targetId: 'all',
      metadata: { affectedCount: count },
      ipAddress: ip,
    });

    return { success: true, message: `تم إعادة التعيين لـ ${count} اشتراك`, affectedCount: count };
  }

  // ─── POST /admin/subscriptions/reset-usage/:tenantId ─────────────────────

  @Post('reset-usage/:tenantId')
  @RequirePermissions(PERMISSIONS.USERS_SUSPEND)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إعادة تعيين الاستخدام الشهري لتاجر' })
  async resetTenantUsage(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    const success = await this.subscriptionService.resetTenantUsage(tenantId);

    await this.auditService.log({
      actor: admin,
      action: 'subscription.reset_usage',
      targetType: 'tenant',
      targetId: tenantId,
      ipAddress: ip,
    });

    return {
      success,
      message: success ? 'تم إعادة تعيين الاستخدام' : 'لا يوجد اشتراك نشط',
    };
  }
}
