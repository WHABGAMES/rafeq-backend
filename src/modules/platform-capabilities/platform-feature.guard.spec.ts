import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../database/entities/user.entity';
import { PlatformFeatureGuard } from './platform-feature.guard';

describe('PlatformFeatureGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue('campaigns') } as unknown as Reflector;
  const capabilities = { requireUsableFeature: jest.fn() };
  const subscriptions = { getSubscriptionInfo: jest.fn() };
  const guard = new PlatformFeatureGuard(reflector, capabilities as never, subscriptions as never);

  const context = (request: Record<string, unknown>) => ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('requires an active store instead of trusting a URL alone', async () => {
    await expect(guard.canActivate(context({ headers: {}, params: {}, user: { tenantId: 'tenant' } })))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes tenant and active store to the ownership-aware capability service', async () => {
    capabilities.requireUsableFeature.mockResolvedValue({ requiredPermission: null, requiredPlanFeature: null });
    await expect(guard.canActivate(context({
      headers: { 'x-store-id': 'store' }, params: {},
      user: { tenantId: 'tenant', role: UserRole.OWNER, preferences: {} },
    }))).resolves.toBe(true);
    expect(capabilities.requireUsableFeature).toHaveBeenCalledWith('campaigns', 'store', 'tenant');
  });

  it('enforces user permission independently from platform targeting', async () => {
    capabilities.requireUsableFeature.mockResolvedValue({ requiredPermission: 'campaigns', requiredPlanFeature: null });
    await expect(guard.canActivate(context({
      headers: { 'x-store-id': 'store' }, params: {},
      user: { tenantId: 'tenant', role: UserRole.AGENT, preferences: { permissions: {} } },
    }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces plan features independently from platform targeting', async () => {
    capabilities.requireUsableFeature.mockResolvedValue({ requiredPermission: null, requiredPlanFeature: 'campaigns' });
    subscriptions.getSubscriptionInfo.mockResolvedValue({ features: { campaigns: false } });
    await expect(guard.canActivate(context({
      headers: { 'x-store-id': 'store' }, params: {},
      user: { tenantId: 'tenant', role: UserRole.OWNER, preferences: {} },
    }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
