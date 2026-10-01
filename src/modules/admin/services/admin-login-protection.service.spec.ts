import { AdminLoginProtectionService } from './admin-login-protection.service';

describe('AdminLoginProtectionService', () => {
  it('locks an account key after repeated failures without storing the email', async () => {
    const values = new Map<string, string>();
    const redis = {
      get: jest.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
      incr: jest.fn((key: string) => {
        const value = Number(values.get(key) || 0) + 1;
        values.set(key, String(value));
        return Promise.resolve(value);
      }),
      expire: jest.fn(() => Promise.resolve(1)),
      del: jest.fn((key: string) => {
        values.delete(key);
        return Promise.resolve(1);
      }),
    };
    const service = new AdminLoginProtectionService(redis as never);

    for (let index = 0; index < 10; index += 1) await service.recordFailure('Admin@Example.com');
    await expect(service.assertAllowed('admin@example.com')).rejects.toMatchObject({ status: 429 });
    expect([...values.keys()][0]).not.toContain('admin@example.com');

    await service.clearFailures('admin@example.com');
    await expect(service.assertAllowed('admin@example.com')).resolves.toBeUndefined();
  });

  it('keeps login available when Redis is temporarily unavailable', async () => {
    const redis = {
      get: jest.fn(() => Promise.reject(new Error('offline'))),
      incr: jest.fn(() => Promise.reject(new Error('offline'))),
      del: jest.fn(() => Promise.reject(new Error('offline'))),
    };
    const service = new AdminLoginProtectionService(redis as never);

    await expect(service.assertAllowed('admin@example.com')).resolves.toBeUndefined();
    await expect(service.recordFailure('admin@example.com')).resolves.toBeUndefined();
    await expect(service.clearFailures('admin@example.com')).resolves.toBeUndefined();
  });
});
