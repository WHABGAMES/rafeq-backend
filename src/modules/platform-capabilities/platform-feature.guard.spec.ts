import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../database/entities/user.entity';
import { PlatformFeatureGuard } from './platform-feature.guard';

describe('PlatformFeatureGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue('campaigns') } as unknown as Reflector;
  const capabilities = { requireAccessibleFeature: jest.fn() };
  const guard = new PlatformFeatureGuard(reflector, capabilities as never);

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
    capabilities.requireAccessibleFeature.mockResolvedValue({});
    await expect(guard.canActivate(context({
      headers: { 'x-store-id': 'store' }, params: {},
      user: { tenantId: 'tenant', role: UserRole.OWNER, preferences: {} },
    }))).resolves.toBe(true);
    expect(capabilities.requireAccessibleFeature).toHaveBeenCalledWith(
      'campaigns',
      'store',
      expect.objectContaining({ tenantId: 'tenant' }),
    );
  });

  it('delegates permission and plan enforcement to the capability service', async () => {
    capabilities.requireAccessibleFeature.mockRejectedValue(new Error('denied'));
    await expect(guard.canActivate(context({
      headers: { 'x-store-id': 'store' }, params: {},
      user: { tenantId: 'tenant', role: UserRole.OWNER, preferences: {} },
    }))).rejects.toThrow('denied');
  });
});
