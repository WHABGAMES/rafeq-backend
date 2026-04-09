/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Subscription Info Controller                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import {
  SubscriptionManagementService,
} from './services/subscription-management.service';
import { SubscriptionExpiryService } from './services/subscription-expiry.service';

interface AuthReq { user: { id: string; tenantId: string; role: string } }

@Controller('billing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@ApiTags('Billing')
export class SubscriptionInfoController {
  constructor(
    private readonly subService: SubscriptionManagementService,
    private readonly expiryService: SubscriptionExpiryService,
  ) {}

  @Get('subscription-info')
  @ApiOperation({ summary: 'معلومات الاشتراك الحالي' })
  async getInfo(@Request() req: AuthReq) {
    const info = await this.subService.getSubscriptionInfo(req.user.tenantId);
    return {
      plan: info.plan,
      status: info.status,
      isActive: info.isActive,
      messages: {
        used: info.messagesUsed,
        limit: info.messagesLimit,
        remaining: info.messagesRemaining,
        percentUsed: info.messagesLimit > 0 ? Math.round((info.messagesUsed / info.messagesLimit) * 100) : 0,
      },
      features: info.features,
      currentPeriodEnd: info.currentPeriodEnd,
    };
  }

  @Get('ai-access')
  @ApiOperation({ summary: 'التحقق من صلاحية AI' })
  async checkAI(@Request() req: AuthReq) {
    return this.subService.checkAIAccess(req.user.tenantId);
  }

  @Get('message-quota')
  @ApiOperation({ summary: 'التحقق من حد الرسائل' })
  async checkQuota(@Request() req: AuthReq) {
    const info = await this.subService.getSubscriptionInfo(req.user.tenantId);
    return {
      canSend: info.isActive && info.messagesRemaining > 0,
      messagesUsed: info.messagesUsed,
      messagesLimit: info.messagesLimit,
      messagesRemaining: info.messagesRemaining,
      plan: info.plan,
    };
  }

  /**
   * 🔒 فحص حالة الاشتراك - يُستدعى عند تسجيل الدخول
   * يعيد رسالة انتهاء الاشتراك والمميزات المعطلة
   */
  @Get('subscription-status')
  @ApiOperation({ summary: 'فحص حالة الاشتراك (انتهاء/إيقاف)' })
  async checkSubscriptionStatus(@Request() req: AuthReq) {
    return this.expiryService.checkTenantSubscriptionStatus(req.user.tenantId);
  }
}
