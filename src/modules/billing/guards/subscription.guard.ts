/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Subscription Guards & Decorators                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  SubscriptionManagementService,
  PlanTier,
  PlanFeatureSet,
} from '../services/subscription-management.service';

// Metadata keys
export const REQUIRED_PLAN_KEY = 'required_plan';
export const REQUIRED_FEATURE_KEY = 'required_feature';
export const CHECK_QUOTA_KEY = 'check_message_quota';

// Decorators
export const RequirePlan = (plan: PlanTier) => SetMetadata(REQUIRED_PLAN_KEY, plan);
export const RequireFeature = (feature: keyof PlanFeatureSet) => SetMetadata(REQUIRED_FEATURE_KEY, feature);
export const CheckMessageQuota = () => SetMetadata(CHECK_QUOTA_KEY, true);

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionManagementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlan = this.reflector.getAllAndOverride<PlanTier>(REQUIRED_PLAN_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    const requiredFeature = this.reflector.getAllAndOverride<keyof PlanFeatureSet>(REQUIRED_FEATURE_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    const checkQuota = this.reflector.getAllAndOverride<boolean>(CHECK_QUOTA_KEY, [
      context.getHandler(), context.getClass(),
    ]);

    if (!requiredPlan && !requiredFeature && !checkQuota) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    if (!tenantId) throw new ForbiddenException({ code: 'NO_TENANT', message: 'لم يتم تحديد التاجر' });

    const info = await this.subscriptionService.getSubscriptionInfo(tenantId);

    // Check plan level
    if (requiredPlan) {
      const levels: Record<PlanTier, number> = { none: 0, basic: 1, professional: 2 };
      if (levels[info.plan] < levels[requiredPlan]) {
        throw new ForbiddenException({
          code: 'PLAN_UPGRADE_REQUIRED',
          message: `هذه الميزة تتطلب الباقة ${requiredPlan === PlanTier.PROFESSIONAL ? 'الاحترافية' : 'الأساسية'}.`,
          currentPlan: info.plan, requiredPlan, upgradeRequired: true,
        });
      }
    }

    // Check feature
    if (requiredFeature) {
      const val = info.features[requiredFeature];
      if (typeof val === 'boolean' && !val) {
        throw new ForbiddenException({
          code: 'FEATURE_NOT_AVAILABLE',
          message: 'هذه الميزة غير متاحة في باقتك الحالية.',
          currentPlan: info.plan, upgradeRequired: true,
        });
      }
    }

    // Check message quota
    if (checkQuota) {
      await this.subscriptionService.checkMessageQuota(tenantId);
    }

    request.subscriptionInfo = info;
    return true;
  }
}

// Combined decorators
export function UseAIGuard() {
  return applyDecorators(RequireFeature('aiBot'), UseGuards(PlanGuard));
}

export function UseMessageQuotaGuard() {
  return applyDecorators(CheckMessageQuota(), UseGuards(PlanGuard));
}
