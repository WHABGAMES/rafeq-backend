/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tenants Controller                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Patch,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { TenantsService, UpdateTenantDto } from './tenants.service';

export class UpdateSettingsDto {
  workingHours?: {
    start: string;
    end: string;
    timezone: string;
  };
  notifications?: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  autoReply?: {
    enabled: boolean;
    message: string;
    outsideWorkingHours: boolean;
  };
}

export class UpdateAiSettingsDto {
  enabled?: boolean;
  tone?: 'friendly' | 'professional' | 'casual';
  language?: string;
  autoHandoff?: boolean;
  handoffAfterFailures?: number;
  welcomeMessage?: string;
  fallbackMessage?: string;
}

@ApiTags('Tenants')
@UseGuards(JwtAuthGuard)
@Controller({
  path: 'tenants',
  version: '1',
})
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'جلب بيانات المستأجر الحالي',
    description: 'يُرجع بيانات المستأجر المرتبط بالمستخدم المسجل',
  })
  @ApiResponse({
    status: 200,
    description: 'بيانات المستأجر',
  })
  async getCurrentTenant() {
    const tenantId = 'test-tenant-id';
    return this.tenantsService.findById(tenantId);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تحديث بيانات المستأجر',
    description: 'تحديث الاسم، الشعار، رقم الهاتف، الموقع، إلخ',
  })
  @ApiResponse({
    status: 200,
    description: 'تم التحديث بنجاح',
  })
  async updateCurrentTenant(
    @Body() dto: UpdateTenantDto,
  ) {
    const tenantId = 'test-tenant-id';
    return this.tenantsService.update(tenantId, dto);
  }

  @Patch('me/settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تحديث الإعدادات العامة',
    description: 'ساعات العمل، الإشعارات، الردود التلقائية',
  })
  async updateSettings(
    @Body() dto: UpdateSettingsDto,
  ) {
    const tenantId = 'test-tenant-id';
    return this.tenantsService.updateSettings(tenantId, dto as Record<string, unknown>);
  }

  @Patch('me/ai')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'تحديث إعدادات الذكاء الاصطناعي',
    description: 'تفعيل/تعطيل، نبرة الصوت، اللغة، التحويل للموظف',
  })
  async updateAiSettings(
    @Body() dto: UpdateAiSettingsDto,
  ) {
    const tenantId = 'test-tenant-id';
    return this.tenantsService.updateAiSettings(tenantId, dto as Record<string, unknown>);
  }

  @Get('me/usage')
  @ApiOperation({
    summary: 'جلب إحصائيات الاستخدام',
    description: 'عدد الرسائل، المحادثات، استدعاءات AI هذا الشهر',
  })
  async getUsage() {
    const tenantId = 'test-tenant-id';
    
    const [tenant, messageLimit] = await Promise.all([
      this.tenantsService.findById(tenantId),
      this.tenantsService.checkMessageLimit(tenantId),
    ]);

    return {
      plan: tenant.subscriptionPlan,
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt,
      subscriptionEndsAt: tenant.subscriptionEndsAt,
      usage: tenant.monthlyUsage,
      limits: tenant.limits,
      messages: messageLimit,
    };
  }

  @Get('me/subscription')
  @ApiOperation({
    summary: 'جلب معلومات الاشتراك',
    description: 'الخطة الحالية، تاريخ الانتهاء، الميزات المتاحة',
  })
  async getSubscription() {
    const tenantId = 'test-tenant-id';
    
    const tenant = await this.tenantsService.findById(tenantId);
    const isValid = await this.tenantsService.isSubscriptionValid(tenantId);

    return {
      plan: tenant.subscriptionPlan,
      status: tenant.status,
      isValid,
      endsAt: tenant.subscriptionEndsAt || tenant.trialEndsAt,
      limits: tenant.limits,
      features: this.getPlanFeatures(tenant.subscriptionPlan),
    };
  }

  private getPlanFeatures(plan: string): string[] {
    const features: Record<string, string[]> = {
      free: [
        '1000 رسالة/شهر',
        '2 مستخدمين',
        'قناة واحدة',
        'AI محدود',
        'دعم عبر البريد',
      ],
      basic: [
        '5000 رسالة/شهر',
        '5 مستخدمين',
        '2 قنوات',
        'AI كامل',
        'حملات تسويقية',
        'دعم عبر الدردشة',
      ],
      pro: [
        '25000 رسالة/شهر',
        '15 مستخدم',
        '5 قنوات',
        'AI متقدم',
        'تحليلات متقدمة',
        'API Access',
        'دعم أولوية',
      ],
      enterprise: [
        'رسائل غير محدودة',
        'مستخدمين غير محدود',
        'قنوات غير محدودة',
        'AI مخصص',
        'تكاملات مخصصة',
        'Account Manager',
        'SLA 99.9%',
      ],
    };

    return features[plan] || features.free;
  }
}
