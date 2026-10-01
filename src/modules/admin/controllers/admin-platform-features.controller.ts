import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions, Require2FA } from '../guards/admin.guards';
import { PERMISSIONS } from '../entities/admin-user.entity';
import { PlatformCapabilitiesService } from '../../platform-capabilities/platform-capabilities.service';
import { UpdatePlatformFeatureDto } from '../../platform-capabilities/dto/update-platform-feature.dto';
import { StorePlatform } from '../../stores/entities/store.entity';

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
  constructor(private readonly capabilitiesService: PlatformCapabilitiesService) {}

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
  update(@Param('featureKey') featureKey: string, @Body() dto: UpdatePlatformFeatureDto) {
    return this.capabilitiesService.update(featureKey, dto);
  }
}
