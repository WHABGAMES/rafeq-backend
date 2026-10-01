import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPermissionGuard, REQUIRE_2FA_KEY, PERMISSIONS_KEY } from './admin.guards';
import { AdminRole, AdminStatus, AdminUser, PERMISSIONS } from '../entities/admin-user.entity';

describe('AdminPermissionGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new AdminPermissionGuard(reflector);
  const admin = Object.assign(new AdminUser(), {
    id: 'admin-id', role: AdminRole.OWNER, status: AdminStatus.ACTIVE, twoFaEnabled: true,
  });
  const context = (request: Record<string, unknown>) => ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('enforces declared permissions', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === PERMISSIONS_KEY ? [PERMISSIONS.TELEGRAM_MANAGE] : false);
    expect(guard.canActivate(context({ admin, adminAuth: { twoFaVerified: true } }))).toBe(true);
  });

  it('rejects a sensitive operation when the current token did not complete 2FA', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === REQUIRE_2FA_KEY ? true : [PERMISSIONS.TELEGRAM_MANAGE]);
    expect(() => guard.canActivate(context({ admin, adminAuth: { twoFaVerified: false } })))
      .toThrow(ForbiddenException);
  });

  it('enforces 2FA even when an endpoint does not declare a permission', () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === REQUIRE_2FA_KEY ? true : undefined);
    expect(() => guard.canActivate(context({ admin, adminAuth: { twoFaVerified: false } })))
      .toThrow(ForbiddenException);
  });

  it('rejects a role that lacks the required permission', () => {
    const support = Object.assign(new AdminUser(), {
      role: AdminRole.SUPPORT, status: AdminStatus.ACTIVE, twoFaEnabled: true,
    });
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === PERMISSIONS_KEY ? [PERMISSIONS.TELEGRAM_MANAGE] : false);
    expect(() => guard.canActivate(context({ admin: support, adminAuth: { twoFaVerified: true } })))
      .toThrow(ForbiddenException);
  });
});
