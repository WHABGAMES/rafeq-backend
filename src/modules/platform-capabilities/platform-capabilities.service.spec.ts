import { FeatureTargetMode, PlatformFeatureStatus } from './entities/platform-feature.entity';
import { isFeatureAvailableForPlatform } from './platform-capabilities.service';
import { PlatformCapabilitiesService } from './platform-capabilities.service';
import { Repository } from 'typeorm';
import { PlatformFeature } from './entities/platform-feature.entity';
import { Store, StorePlatform, StoreStatus } from '../stores/entities/store.entity';
import { User, UserRole } from '../../database/entities/user.entity';

const feature = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  status: PlatformFeatureStatus.ACTIVE,
  targetMode: FeatureTargetMode.ALL,
  platforms: [],
  ...overrides,
});

describe('platform feature targeting', () => {
  it('keeps existing features available to every platform by default', () => {
    expect(isFeatureAvailableForPlatform(feature(), 'salla')).toBe(true);
    expect(isFeatureAvailableForPlatform(feature(), 'future-platform')).toBe(true);
  });

  it('supports include and exclude targeting without platform-specific code', () => {
    expect(isFeatureAvailableForPlatform(feature({ targetMode: FeatureTargetMode.INCLUDE, platforms: ['zid'] }), 'zid')).toBe(true);
    expect(isFeatureAvailableForPlatform(feature({ targetMode: FeatureTargetMode.INCLUDE, platforms: ['zid'] }), 'salla')).toBe(false);
    expect(isFeatureAvailableForPlatform(feature({ targetMode: FeatureTargetMode.EXCLUDE, platforms: ['zid'] }), 'salla')).toBe(true);
    expect(isFeatureAvailableForPlatform(feature({ targetMode: FeatureTargetMode.EXCLUDE, platforms: ['zid'] }), 'zid')).toBe(false);
  });

  it('never exposes disabled or hidden features', () => {
    expect(isFeatureAvailableForPlatform(feature({ enabled: false }), 'salla')).toBe(false);
    expect(isFeatureAvailableForPlatform(feature({ status: PlatformFeatureStatus.HIDDEN }), 'salla')).toBe(false);
  });
});

describe('PlatformCapabilitiesService workspace isolation', () => {
  const featureRepository = {
    find: jest.fn(),
  } as unknown as Repository<PlatformFeature>;
  const storeRepository = {
    findOne: jest.fn(),
  } as unknown as Repository<Store>;
  const subscriptions = { getSubscriptionInfo: jest.fn() };
  const service = new PlatformCapabilitiesService(featureRepository, storeRepository, subscriptions as never);

  beforeEach(() => jest.clearAllMocks());

  it('queries by both store id and tenant id', async () => {
    (storeRepository.findOne as jest.Mock).mockResolvedValue(null);
    await expect(service.resolveWorkspace('store-id', {
      tenantId: 'tenant-id', role: UserRole.OWNER, preferences: {},
    } as User)).rejects.toThrow('Store not found');
    expect(storeRepository.findOne).toHaveBeenCalledWith({ where: { id: 'store-id', tenantId: 'tenant-id' } });
  });

  it('returns only features available for the owned store platform', async () => {
    (storeRepository.findOne as jest.Mock).mockResolvedValue({
      id: 'store-id', tenantId: 'tenant-id', name: 'Test', platform: StorePlatform.SALLA, status: StoreStatus.ACTIVE,
    });
    (featureRepository.find as jest.Mock).mockResolvedValue([
      { ...feature(), featureKey: 'all', name: 'All', category: 'core', route: '/all', showInNavigation: true, displayOrder: 1, config: {} },
      { ...feature({ targetMode: FeatureTargetMode.INCLUDE, platforms: ['zid'] }), featureKey: 'zid', name: 'Zid', category: 'core', route: '/zid', showInNavigation: true, displayOrder: 2, config: {} },
    ]);

    const workspace = await service.resolveWorkspace('store-id', {
      tenantId: 'tenant-id', role: UserRole.OWNER, preferences: {},
    } as unknown as User);
    expect(workspace.features.map(item => item.key)).toEqual(['all']);
  });

  it('removes features denied by user permission or subscription plan', async () => {
    (storeRepository.findOne as jest.Mock).mockResolvedValue({
      id: 'store-id', tenantId: 'tenant-id', name: 'Test', platform: StorePlatform.ZID, status: StoreStatus.ACTIVE,
    });
    (featureRepository.find as jest.Mock).mockResolvedValue([
      { ...feature(), featureKey: 'allowed', name: 'Allowed', category: 'core', route: '/allowed', showInNavigation: true, displayOrder: 1, config: {}, requiredPermission: 'contacts' },
      { ...feature(), featureKey: 'denied-permission', name: 'Denied', category: 'core', route: '/denied', showInNavigation: true, displayOrder: 2, config: {}, requiredPermission: 'campaigns' },
      { ...feature(), featureKey: 'denied-plan', name: 'Plan', category: 'core', route: '/plan', showInNavigation: true, displayOrder: 3, config: {}, requiredPlanFeature: 'aiBot' },
    ]);
    subscriptions.getSubscriptionInfo.mockResolvedValue({ features: { aiBot: false } });

    const workspace = await service.resolveWorkspace('store-id', {
      tenantId: 'tenant-id', role: UserRole.AGENT, preferences: { permissions: { contacts: true } },
    } as unknown as User);
    expect(workspace.features.map(item => item.key)).toEqual(['allowed']);
  });

  it('does not expose a subfeature when its parent is unavailable for the platform', async () => {
    (storeRepository.findOne as jest.Mock).mockResolvedValue({
      id: 'store-id', tenantId: 'tenant-id', name: 'Test', platform: StorePlatform.SALLA, status: StoreStatus.ACTIVE,
    });
    (featureRepository.find as jest.Mock).mockResolvedValue([
      { ...feature({ targetMode: FeatureTargetMode.INCLUDE, platforms: ['zid'] }), featureKey: 'campaigns', name: 'Campaigns', category: 'growth', route: '/campaigns', showInNavigation: true, displayOrder: 1, config: {} },
      { ...feature(), featureKey: 'campaigns.send', parentFeatureKey: 'campaigns', name: 'Send', category: 'growth', route: '/campaigns', showInNavigation: false, displayOrder: 2, config: {} },
    ]);

    const workspace = await service.resolveWorkspace('store-id', {
      tenantId: 'tenant-id', role: UserRole.OWNER, preferences: {},
    } as unknown as User);
    expect(workspace.features).toHaveLength(0);
  });

  it('blocks a direct subfeature API call when its parent is disabled', async () => {
    (storeRepository.findOne as jest.Mock).mockResolvedValue({
      id: 'store-id', tenantId: 'tenant-id', name: 'Test', platform: StorePlatform.ZID, status: StoreStatus.ACTIVE,
    });
    (featureRepository.find as jest.Mock).mockResolvedValue([
      { ...feature({ enabled: false }), featureKey: 'templates' },
      { ...feature(), featureKey: 'templates.edit', parentFeatureKey: 'templates' },
    ]);

    await expect(service.requireUsableFeature('templates.edit', 'store-id', 'tenant-id'))
      .rejects.toMatchObject({ response: { code: 'PLATFORM_FEATURE_UNAVAILABLE' } });
  });
});
