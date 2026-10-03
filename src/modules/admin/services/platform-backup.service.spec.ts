import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  Interval: () => () => undefined,
}));
import {
  PlatformBackup,
  PlatformBackupStatus,
  PlatformBackupTrigger,
} from '../entities/platform-backup.entity';
import { BackupObjectStorageService } from './backup-object-storage.service';
import { PlatformBackupService } from './platform-backup.service';

describe('PlatformBackupService', () => {
  const values: Record<string, string> = {
    BACKUP_ENABLED: 'true',
    BACKUP_RETENTION_DAYS: '30',
    BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32),
    DB_NAME: 'defaultdb',
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
  const repository = {
    exists: jest.fn(),
    create: jest.fn((input: Partial<PlatformBackup>) => input),
    save: jest.fn(async (input: Partial<PlatformBackup>) => ({
      id: 'backup-id',
      ...input,
    })),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<PlatformBackup>>;
  const storage = {
    isConfigured: jest.fn(() => true),
  } as unknown as jest.Mocked<BackupObjectStorageService>;

  let service: PlatformBackupService;

  beforeEach(() => {
    jest.clearAllMocks();
    (storage.isConfigured as jest.Mock).mockReturnValue(true);
    service = new PlatformBackupService(repository, config, storage);
  });

  it('only requeues workers whose heartbeat lease is stale', async () => {
    (repository.update as jest.Mock).mockResolvedValue({ affected: 0 });

    await service.onModuleInit();

    expect(repository.update).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          status: PlatformBackupStatus.RUNNING,
          heartbeatAt: expect.any(Object),
        }),
        expect.objectContaining({
          status: PlatformBackupStatus.RUNNING,
          startedAt: expect.any(Object),
        }),
      ]),
      expect.objectContaining({
        status: PlatformBackupStatus.PENDING,
        startedAt: null,
        heartbeatAt: null,
      }),
    );
  });

  it('reports readiness only when storage and a valid encryption key are configured', () => {
    expect(service.getConfiguration()).toMatchObject({
      enabled: true,
      storageConfigured: true,
      encryptionConfigured: true,
      retentionDays: 30,
    });

    values.BACKUP_ENCRYPTION_KEY = 'invalid';
    expect(service.getConfiguration().encryptionConfigured).toBe(false);
    values.BACKUP_ENCRYPTION_KEY = 'ab'.repeat(32);
  });

  it('queues one manual full-database backup with the requesting admin', async () => {
    (repository.exists as jest.Mock).mockResolvedValue(false);

    await expect(service.requestManualBackup('admin-id')).resolves.toMatchObject({
      id: 'backup-id',
      status: PlatformBackupStatus.PENDING,
      trigger: PlatformBackupTrigger.MANUAL,
      requestedBy: 'admin-id',
      databaseName: 'defaultdb',
    });
  });

  it('rejects a second request while a backup is active', async () => {
    (repository.exists as jest.Mock).mockResolvedValue(true);
    await expect(service.requestManualBackup('admin-id')).rejects.toThrow(
      'already queued or running',
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('fails closed when independent storage is not configured', async () => {
    (storage.isConfigured as jest.Mock).mockReturnValue(false);
    await expect(service.requestManualBackup('admin-id')).rejects.toThrow(
      'Off-site backup storage is not configured',
    );
  });

  it('does not enqueue scheduled work until every required secret is ready', async () => {
    (storage.isConfigured as jest.Mock).mockReturnValue(false);
    await service.scheduleDailyBackup();
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('schedules a replacement when no completed backup exists', async () => {
    (repository.findOne as jest.Mock).mockResolvedValue(null);
    (repository.exists as jest.Mock).mockResolvedValue(false);

    await service.scheduleDailyBackup();

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { status: PlatformBackupStatus.COMPLETED },
      order: { completedAt: 'DESC' },
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: PlatformBackupTrigger.SCHEDULED }),
    );
  });

  it('does not expose storage keys or requester identifiers in list responses', async () => {
    (repository.find as jest.Mock).mockResolvedValue([
      {
        id: 'backup-id',
        status: PlatformBackupStatus.COMPLETED,
        objectKey: 'private/path.dump.enc',
        requestedBy: 'admin-id',
        databaseName: 'defaultdb',
      },
    ]);

    const [backup] = await service.list();
    expect(backup.objectKey).toBeUndefined();
    expect(backup.requestedBy).toBeUndefined();
    expect(backup.databaseName).toBe('platform');
  });
});
