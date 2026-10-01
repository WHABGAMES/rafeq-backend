import { ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '../stores/entities/store.entity';
import { FEATURE_CATALOG } from './feature-catalog';
import { FeatureTargetMode, PlatformFeature, PlatformFeatureStatus } from './entities/platform-feature.entity';
import { UpdatePlatformFeatureDto } from './dto/update-platform-feature.dto';
import { User, UserRole } from '../../database/entities/user.entity';
import { PlanFeatureSet, SubscriptionManagementService } from '../billing/services/subscription-management.service';

export function isFeatureAvailableForPlatform(
  feature: Pick<PlatformFeature, 'enabled' | 'status' | 'targetMode' | 'platforms'>,
  platform: string,
): boolean {
  if (!feature.enabled || feature.status === PlatformFeatureStatus.HIDDEN) return false;
  const selected = feature.platforms.includes(platform);
  if (feature.targetMode === FeatureTargetMode.INCLUDE) return selected;
  if (feature.targetMode === FeatureTargetMode.EXCLUDE) return !selected;
  return true;
}

@Injectable()
export class PlatformCapabilitiesService implements OnModuleInit {
  constructor(
    @InjectRepository(PlatformFeature) private readonly featureRepository: Repository<PlatformFeature>,
    @InjectRepository(Store) private readonly storeRepository: Repository<Store>,
    private readonly subscriptions: SubscriptionManagementService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureCatalogRows();
  }

  async ensureCatalogRows(): Promise<void> {
    const existing = new Set((await this.featureRepository.find({ select: { featureKey: true } })).map(row => row.featureKey));
    const missing = FEATURE_CATALOG.filter(feature => !existing.has(feature.key));
    const rows = missing.map(feature => ({
      featureKey: feature.key,
      parentFeatureKey: feature.parentKey ?? null,
      name: feature.name,
      category: feature.category,
      route: feature.route,
      displayOrder: feature.order,
      requiredPermission: feature.requiredPermission ?? null,
      requiredPlanFeature: feature.requiredPlanFeature ?? null,
      targetMode: FeatureTargetMode.ALL,
      platforms: [],
      enabled: true,
      showInNavigation: feature.showInNavigation ?? true,
      status: PlatformFeatureStatus.ACTIVE,
    }));
    // Multiple application instances may start together. ON CONFLICT keeps
    // catalog bootstrap idempotent without overwriting admin configuration.
    if (rows.length) {
      await this.featureRepository.createQueryBuilder().insert().values(rows).orIgnore().execute();
    }

    // Synchronize catalog-owned metadata while preserving every admin-owned
    // targeting field (platforms, mode, enabled, status, navigation and order).
    await Promise.all(FEATURE_CATALOG.map(feature => this.featureRepository.update(
      { featureKey: feature.key },
      {
        name: feature.name,
        parentFeatureKey: feature.parentKey ?? null,
        category: feature.category,
        route: feature.route,
        requiredPermission: feature.requiredPermission ?? null,
        requiredPlanFeature: feature.requiredPlanFeature ?? null,
      },
    )));
  }

  list(): Promise<PlatformFeature[]> {
    return this.featureRepository.find({ order: { displayOrder: 'ASC', name: 'ASC' } });
  }

  async update(featureKey: string, dto: UpdatePlatformFeatureDto): Promise<PlatformFeature> {
    const feature = await this.featureRepository.findOne({ where: { featureKey } });
    if (!feature) throw new NotFoundException('Feature not found');
    Object.assign(feature, dto);
    return this.featureRepository.save(feature);
  }

  async resolveWorkspace(storeId: string, user: User) {
    const store = await this.storeRepository.findOne({ where: { id: storeId, tenantId: user.tenantId } });
    if (!store) throw new NotFoundException('Store not found');

    const configuredFeatures = await this.list();
    const featureMap = new Map(configuredFeatures.map(feature => [feature.featureKey, feature]));
    const candidates = configuredFeatures.filter(feature => this.isPermittedForUser(feature, user));
    const needsPlan = candidates.some(feature => feature.requiredPlanFeature);
    const planFeatures = needsPlan
      ? (await this.subscriptions.getSubscriptionInfo(user.tenantId)).features
      : null;
    const features = candidates
      .filter(feature => this.isAvailableWithParents(feature, featureMap, store.platform))
      .filter(feature => !feature.requiredPlanFeature
        || planFeatures?.[feature.requiredPlanFeature as keyof PlanFeatureSet] === true)
      .map(feature => ({
        key: feature.featureKey,
        parentKey: feature.parentFeatureKey,
        name: feature.name,
        category: feature.category,
        route: feature.route,
        status: feature.status,
        showInNavigation: feature.showInNavigation,
        displayOrder: feature.displayOrder,
        requiredPermission: feature.requiredPermission,
        requiredPlanFeature: feature.requiredPlanFeature,
        config: feature.config,
      }));

    return {
      store: { id: store.id, name: store.name, platform: store.platform, status: store.status },
      landingRoute: '/dashboard/store-settings',
      features,
    };
  }

  private isPermittedForUser(feature: PlatformFeature, user: User): boolean {
    if (!feature.requiredPermission || user.role === UserRole.OWNER) return true;
    const permissions = user.preferences?.permissions;
    return typeof permissions === 'object' && permissions !== null
      && (permissions as Record<string, unknown>)[feature.requiredPermission] === true;
  }

  async requireUsableFeature(featureKey: string, storeId: string, tenantId: string): Promise<PlatformFeature> {
    const store = await this.storeRepository.findOne({ where: { id: storeId, tenantId } });
    if (!store) throw new NotFoundException('Store not found');
    const configuredFeatures = await this.list();
    const featureMap = new Map(configuredFeatures.map(item => [item.featureKey, item]));
    const feature = featureMap.get(featureKey);
    const usable = feature
      && this.isAvailableWithParents(feature, featureMap, store.platform)
      && feature.status !== PlatformFeatureStatus.MAINTENANCE;
    if (!usable) {
      throw new ForbiddenException({ code: 'PLATFORM_FEATURE_UNAVAILABLE', message: 'الميزة غير متاحة لهذا المتجر.' });
    }
    return feature;
  }

  private isAvailableWithParents(
    feature: PlatformFeature,
    featureMap: Map<string, PlatformFeature>,
    platform: string,
    visited = new Set<string>(),
  ): boolean {
    if (visited.has(feature.featureKey)) return false;
    visited.add(feature.featureKey);
    if (!isFeatureAvailableForPlatform(feature, platform)) return false;
    if (!feature.parentFeatureKey) return true;
    const parent = featureMap.get(feature.parentFeatureKey);
    return Boolean(parent && this.isAvailableWithParents(parent, featureMap, platform, visited));
  }

}
