const DEVELOPMENT_ADMIN_SECRET = 'rafeq-admin-development-secret-change-me';

export function getAdminJwtSecret(): string {
  const adminSecret = process.env.ADMIN_JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!adminSecret) {
    if (isProduction) {
      throw new Error('ADMIN_JWT_SECRET is required in production and must be independent from JWT_SECRET');
    }
    return DEVELOPMENT_ADMIN_SECRET;
  }

  if (adminSecret.length < 32) {
    throw new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
  }
  if (isProduction && adminSecret === process.env.JWT_SECRET) {
    throw new Error('ADMIN_JWT_SECRET must be different from JWT_SECRET in production');
  }

  return adminSecret;
}
