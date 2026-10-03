import { ConfigService } from '@nestjs/config';
import { BackupObjectStorageService } from './backup-object-storage.service';

describe('BackupObjectStorageService configuration', () => {
  const valid: Record<string, string> = {
    NODE_ENV: 'production',
    BACKUP_S3_ENDPOINT: 'https://lon1.digitaloceanspaces.com',
    BACKUP_S3_REGION: 'lon1',
    BACKUP_S3_BUCKET: 'rafeq-private-backups',
    BACKUP_S3_ACCESS_KEY: 'access-key',
    BACKUP_S3_SECRET_KEY: 'secret-key',
  };

  function createService(overrides: Record<string, string> = {}) {
    const values = { ...valid, ...overrides };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        if (!values[key]) throw new Error(`Missing ${key}`);
        return values[key];
      }),
    } as unknown as ConfigService;
    return new BackupObjectStorageService(config);
  }

  it('accepts a private DigitalOcean Spaces-compatible endpoint', () => {
    expect(createService().isConfigured()).toBe(true);
  });

  it('rejects plaintext storage endpoints in production', () => {
    expect(
      createService({ BACKUP_S3_ENDPOINT: 'http://lon1.digitaloceanspaces.com' }).isConfigured(),
    ).toBe(false);
  });

  it('rejects endpoint paths and invalid bucket names', () => {
    expect(
      createService({
        BACKUP_S3_ENDPOINT: 'https://lon1.digitaloceanspaces.com/path',
      }).isConfigured(),
    ).toBe(false);
    expect(createService({ BACKUP_S3_BUCKET: 'Invalid Bucket' }).isConfigured()).toBe(false);
  });
});
