import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsrfGuard } from './csrf.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const productionConfig = {
    get: jest.fn().mockReturnValue('production'),
  } as unknown as ConfigService;

  it('requires a matching double-submit token for cookie refresh requests', () => {
    const guard = new CsrfGuard(productionConfig);
    const token = 'a'.repeat(64);

    expect(guard.canActivate(contextFor({
      method: 'POST',
      path: '/api/auth/refresh',
      cookies: { rafeq_rt: 'refresh-cookie', 'csrf-token': token },
      headers: { 'x-csrf-token': token },
    }))).toBe(true);
  });

  it('rejects a cookie refresh request without a CSRF header', () => {
    const guard = new CsrfGuard(productionConfig);

    expect(() => guard.canActivate(contextFor({
      method: 'POST',
      path: '/api/admin/auth/refresh',
      cookies: { rafeq_admin_rt: 'refresh-cookie', 'csrf-token': 'token' },
      headers: {},
    }))).toThrow(ForbiddenException);
  });

  it('does not apply browser CSRF rules to a provider webhook', () => {
    const guard = new CsrfGuard(productionConfig);

    expect(guard.canActivate(contextFor({
      method: 'POST',
      path: '/api/webhooks/salla',
      cookies: {},
      headers: {},
    }))).toBe(true);
  });
});
