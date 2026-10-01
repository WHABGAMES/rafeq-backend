import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { User } from '../../database/entities/user.entity';
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

    await this.capabilitiesService.requireAccessibleFeature(featureKey, storeId, request.user);
    return true;
  }

  private readStoreId(request: FeatureRequest): string | undefined {
    const header = request.headers['x-store-id'];
    if (Array.isArray(header)) return header[0];
    return header || request.params?.storeId;
  }
}
