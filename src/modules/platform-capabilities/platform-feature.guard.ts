import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { User, UserRole } from '../../database/entities/user.entity';
import { SubscriptionManagementService, PlanFeatureSet } from '../billing/services/subscription-management.service';
import { PLATFORM_FEATURE_KEY } from './platform-feature.decorator';
import { PlatformCapabilitiesService } from './platform-capabilities.service';

interface FeatureRequest extends Request {
  user: User;
}

@Injectable()
export class PlatformFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly capabilitiesService: PlatformCapabilitiesService,
    private readonly subscriptions: SubscriptionManagementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string>(PLATFORM_FEATURE_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (!featureKey) return true;

    const request = context.switchToHttp().getRequest<FeatureRequest>();
    const storeId = this.readStoreId(request);
    if (!storeId) {
      throw new BadRequestException({ code: 'ACTIVE_STORE_REQUIRED', message: 'يجب اختيار متجر نشط.' });
    }

    const feature = await this.capabilitiesService.requireUsableFeature(featureKey, storeId, request.user.tenantId);

    if (feature.requiredPermission && !this.hasPermission(request.user, feature.requiredPermission)) {
      throw new ForbiddenException({ code: 'FEATURE_PERMISSION_REQUIRED', message: 'لا تملك صلاحية استخدام هذه الميزة.' });
    }

    if (feature.requiredPlanFeature) {
      const subscription = await this.subscriptions.getSubscriptionInfo(request.user.tenantId);
      const planValue = subscription.features[feature.requiredPlanFeature as keyof PlanFeatureSet];
      if (planValue !== true) {
        throw new ForbiddenException({ code: 'FEATURE_PLAN_REQUIRED', message: 'هذه الميزة غير متاحة ضمن باقتك الحالية.' });
      }
    }
    return true;
  }

  private readStoreId(request: FeatureRequest): string | undefined {
    const header = request.headers['x-store-id'];
    if (Array.isArray(header)) return header[0];
    return header || request.params?.storeId;
  }

  private hasPermission(user: User, permission: string): boolean {
    if (user.role === UserRole.OWNER) return true;
    const permissions = user.preferences?.permissions;
    return typeof permissions === 'object' && permissions !== null
      && (permissions as Record<string, unknown>)[permission] === true;
  }
}
