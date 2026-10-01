import { getAdminJwtSecret } from './admin-jwt-secret';

describe('getAdminJwtSecret', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('requires a dedicated secret in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_JWT_SECRET;
    expect(() => getAdminJwtSecret()).toThrow('ADMIN_JWT_SECRET is required');
  });

  it('rejects sharing the user JWT secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'same-secret-with-at-least-32-characters';
    process.env.ADMIN_JWT_SECRET = process.env.JWT_SECRET;
    expect(() => getAdminJwtSecret()).toThrow('must be different');
  });

  it('accepts an independent strong admin secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'user-secret-with-at-least-32-characters';
    process.env.ADMIN_JWT_SECRET = 'admin-secret-with-at-least-32-characters';
    expect(getAdminJwtSecret()).toBe(process.env.ADMIN_JWT_SECRET);
  });
});
