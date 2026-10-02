import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions, Require2FA } from '../guards/admin.guards';
import { PERMISSIONS } from '../entities/admin-user.entity';
import { PlatformCapabilitiesService } from '../../platform-capabilities/platform-capabilities.service';
import { UpdatePlatformFeatureDto } from '../../platform-capabilities/dto/update-platform-feature.dto';
import { StorePlatform } from '../../stores/entities/store.entity';
import { CurrentAdmin, AdminIp } from '../decorators/current-admin.decorator';
import { AdminUser } from '../entities/admin-user.entity';
import { AuditService } from '../services/audit.service';

const PLATFORM_LABELS: Record<StorePlatform, string> = {
  [StorePlatform.SALLA]: 'سلة',
  [StorePlatform.ZID]: 'زد',
  [StorePlatform.SHOPIFY]: 'Shopify',
  [StorePlatform.OTHER]: 'متاجر أخرى',
};

@Controller('admin/platform-features')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@RequirePermissions(PERMISSIONS.PLATFORM_FEATURES_MANAGE)
export class AdminPlatformFeaturesController {
  constructor(
    private readonly capabilitiesService: PlatformCapabilitiesService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  list() {
    return this.capabilitiesService.list();
  }

  @Get('supported-platforms')
  supportedPlatforms() {
    return Object.values(StorePlatform).map(key => ({ key, label: PLATFORM_LABELS[key] }));
  }

  @Patch(':featureKey')
  @Require2FA()
  async update(
    @Param('featureKey') featureKey: string,
    @Body() dto: UpdatePlatformFeatureDto,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const feature = await this.capabilitiesService.update(featureKey, dto);
    await this.auditService.log({
      actor: admin,
      action: 'platform_feature.updated',
      targetType: 'platform_feature',
      targetId: featureKey,
      metadata: {
        enabled: feature.enabled,
        showInNavigation: feature.showInNavigation,
        targetMode: feature.targetMode,
        platforms: feature.platforms,
        status: feature.status,
        displayOrder: feature.displayOrder,
      },
      ipAddress,
    });
    return feature;
  }
}
