import { ConfigService } from '@nestjs/config';
import { buildTypeOrmOptions } from './typeorm.config';

const createProductionConfig = (overrides: Record<string, unknown> = {}) =>
  new ConfigService({
    app: { env: 'production' },
    database: { ssl: true, synchronize: false },
    DB_CA_CERT: Buffer.from('test-ca').toString('base64'),
    ...overrides,
  });

describe('buildTypeOrmOptions database pool', () => {
  it('uses rolling-deployment-safe production defaults', () => {
    const options = buildTypeOrmOptions(createProductionConfig());

    expect(options.extra).toMatchObject({ min: 0, max: 8 });
  });

  it('accepts an explicitly sized pool', () => {
    const options = buildTypeOrmOptions(createProductionConfig({
      DB_POOL_MIN: '1',
      DB_POOL_MAX: '12',
    }));

    expect(options.extra).toMatchObject({ min: 1, max: 12 });
  });

  it.each([
    [{ DB_POOL_MIN: '-1' }, 'DB_POOL_MIN must be a non-negative integer'],
    [{ DB_POOL_MAX: 'not-a-number' }, 'DB_POOL_MAX must be a non-negative integer'],
    [{ DB_POOL_MIN: '9', DB_POOL_MAX: '8' }, 'Invalid database pool configuration'],
    [{ DB_POOL_MAX: '0' }, 'Invalid database pool configuration'],
  ])('rejects an invalid pool configuration: %p', (overrides, expectedMessage) => {
    expect(() => buildTypeOrmOptions(createProductionConfig(overrides)))
      .toThrow(expectedMessage);
  });
});
