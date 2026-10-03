import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { appendFile, mkdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { IsNull, LessThan, Repository } from 'typeorm';
import {
  PlatformBackup,
  PlatformBackupStatus,
  PlatformBackupTrigger,
} from '../entities/platform-backup.entity';
import { BackupObjectStorageService } from './backup-object-storage.service';

const BACKUP_FORMAT_MAGIC = Buffer.from('RFBACK01');
@Injectable()
export class PlatformBackupService implements OnModuleInit {
  private readonly logger = new Logger(PlatformBackupService.name);
  private processing = false;

  constructor(
    @InjectRepository(PlatformBackup)
    private readonly backupRepository: Repository<PlatformBackup>,
    private readonly configService: ConfigService,
    private readonly objectStorage: BackupObjectStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    // A container may stop during a dump. Return abandoned jobs to the queue so
    // another healthy instance can retry instead of showing "running" forever.
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    await this.backupRepository.update(
      [
        { status: PlatformBackupStatus.RUNNING, heartbeatAt: LessThan(staleBefore) },
        {
          status: PlatformBackupStatus.RUNNING,
          heartbeatAt: IsNull(),
          startedAt: LessThan(staleBefore),
        },
      ],
      {
        status: PlatformBackupStatus.PENDING,
        startedAt: null,
        heartbeatAt: null,
        errorMessage: 'Previous worker stopped before completion; queued again',
      },
    );
  }

  getConfiguration() {
    const retentionDays = this.getRetentionDays();
    return {
      enabled: this.isEnabled(),
      storageConfigured: this.objectStorage.isConfigured(),
      encryptionConfigured: this.getEncryptionKey(false).length === 32,
      schedule: '02:00 UTC daily; automatic retry windows at 03:00 and 06:00 UTC',
      retentionDays,
      includes:
        'Full PostgreSQL database (all tables, conversations, reports, settings and audit records)',
      providerBackup: 'DigitalOcean Managed PostgreSQL PITR (7 days)',
    };
  }

  async list(limit = 50): Promise<PlatformBackup[]> {
    const backups = await this.backupRepository.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return backups.map((backup) => ({
      ...backup,
      objectKey: undefined,
      requestedBy: undefined,
      databaseName: 'platform',
    }));
  }

  async requestManualBackup(adminId: string): Promise<PlatformBackup> {
    this.assertReady();
    return this.enqueue(PlatformBackupTrigger.MANUAL, adminId);
  }

  @Cron('0 0 2,3,6 * * *')
  async scheduleDailyBackup(): Promise<void> {
    if (!this.isReady()) return;
    const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
    const latest = await this.backupRepository.findOne({
      where: { status: PlatformBackupStatus.COMPLETED },
      order: { completedAt: 'DESC' },
    });
    if (!latest || latest.createdAt < since) {
      await this.enqueue(PlatformBackupTrigger.SCHEDULED, null);
    }
  }

  @Interval(30_000)
  async processQueue(): Promise<void> {
    if (!this.isReady() || this.processing) return;
    this.processing = true;
    try {
      const claimed: Array<{ id: string }> = await this.backupRepository.query(`
        UPDATE platform_backups
        SET status = 'running', started_at = NOW(), heartbeat_at = NOW(),
            updated_at = NOW(), error_message = NULL
        WHERE id = (
          SELECT id FROM platform_backups
          WHERE status = 'pending'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id
      `);
      if (claimed[0]?.id) {
        const next = await this.backupRepository.findOneByOrFail({
          id: claimed[0].id,
        });
        await this.executeBackup(next);
      }
      await this.expireOldBackups();
    } finally {
      this.processing = false;
    }
  }

  private async enqueue(
    trigger: PlatformBackupTrigger,
    requestedBy: string | null,
  ): Promise<PlatformBackup> {
    const active = await this.backupRepository.exists({
      where: [{ status: PlatformBackupStatus.PENDING }, { status: PlatformBackupStatus.RUNNING }],
    });
    if (active) throw new Error('A platform backup is already queued or running');

    return this.backupRepository.save(
      this.backupRepository.create({
        status: PlatformBackupStatus.PENDING,
        trigger,
        databaseName: this.configService.get<string>('DB_NAME', 'rafiq_db'),
        requestedBy,
      }),
    );
  }

  private async executeBackup(backup: PlatformBackup): Promise<void> {
    const workDir = join(tmpdir(), `rafeq-backup-${backup.id}`);
    const encryptedPath = join(workDir, 'database.dump.enc');
    const caPath = join(workDir, 'database-ca.pem');
    let uploadedObjectKey: string | null = null;
    const heartbeat = setInterval(() => {
      void this.backupRepository
        .update(backup.id, { heartbeatAt: new Date() })
        .catch((error: unknown) =>
          this.logger.warn(
            `Backup heartbeat failed: ${backup.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ),
        );
    }, 30_000);
    heartbeat.unref();
    try {
      await mkdir(workDir, { recursive: true });
      await this.dumpEncrypted(encryptedPath, caPath);
      const fileStat = await stat(encryptedPath);
      const sha256 = await this.hashFile(encryptedPath);
      const encryptionKeyId = this.getEncryptionKeyId();
      const objectKey = `platform/${new Date().toISOString().slice(0, 10)}/${backup.id}.pgdump.enc`;
      await this.objectStorage.putFile(
        objectKey,
        encryptedPath,
        fileStat.size,
        sha256,
        encryptionKeyId,
      );
      uploadedObjectKey = objectKey;
      await this.objectStorage.assertObjectIntegrity(
        objectKey,
        fileStat.size,
        sha256,
        encryptionKeyId,
      );

      backup.status = PlatformBackupStatus.COMPLETED;
      backup.objectKey = objectKey;
      backup.sizeBytes = String(fileStat.size);
      backup.sha256 = sha256;
      backup.encryptionKeyId = encryptionKeyId;
      backup.completedAt = new Date();
      backup.expiresAt = new Date(Date.now() + this.getRetentionDays() * 86_400_000);
      await this.backupRepository.save(backup);
      this.logger.log(`Platform backup completed: ${backup.id}`);
    } catch (error) {
      if (uploadedObjectKey) {
        try {
          await this.objectStorage.deleteObject(uploadedObjectKey);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to remove unverified backup object: ${backup.id}`,
            cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup failure',
          );
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown backup failure';
      backup.status = PlatformBackupStatus.FAILED;
      backup.completedAt = new Date();
      backup.errorMessage = message.slice(0, 500);
      await this.backupRepository.save(backup);
      this.logger.error(`Platform backup failed: ${backup.id}`, message);
    } finally {
      clearInterval(heartbeat);
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async dumpEncrypted(destination: string, caPath: string): Promise<void> {
    const caBase64 = this.configService.get<string>('DB_CA_CERT');
    const caConfiguredPath = this.configService.get<string>('DB_CA_CERT_PATH');
    let sslRootCert: string | undefined;
    if (caBase64) {
      await writeFile(caPath, Buffer.from(caBase64, 'base64'), { mode: 0o600 });
      sslRootCert = caPath;
    } else if (caConfiguredPath) {
      sslRootCert = caConfiguredPath;
    }

    const args = [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-acl',
      '--host',
      this.configService.get<string>('DB_HOST', 'localhost'),
      '--port',
      String(this.configService.get<number>('DB_PORT', 5432)),
      '--username',
      this.configService.get<string>('DB_USERNAME', 'rafiq_user'),
      '--dbname',
      this.configService.get<string>('DB_NAME', 'rafiq_db'),
    ];
    const child = spawn('pg_dump', args, {
      env: {
        ...process.env,
        PGPASSWORD: this.configService.get<string>('DB_PASSWORD', ''),
        PGSSLMODE: sslRootCert ? 'verify-full' : 'require',
        ...(sslRootCert ? { PGSSLROOTCERT: sslRootCert } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const key = this.getEncryptionKey(true);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    await writeFile(destination, Buffer.concat([BACKUP_FORMAT_MAGIC, iv]), { mode: 0o600 });

    const processCompleted = new Promise<void>((resolve, reject) => {
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 10_000) stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
      });
    });
    await Promise.all([
      processCompleted,
      pipeline(child.stdout, cipher, createWriteStream(destination, { flags: 'a', mode: 0o600 })),
    ]);
    await appendFile(destination, cipher.getAuthTag());
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
  }

  private async expireOldBackups(): Promise<void> {
    const expired = await this.backupRepository.find({
      where: {
        status: PlatformBackupStatus.COMPLETED,
        expiresAt: LessThan(new Date()),
      },
      take: 20,
    });
    for (const backup of expired) {
      if (backup.objectKey) await this.objectStorage.deleteObject(backup.objectKey);
      backup.status = PlatformBackupStatus.EXPIRED;
      backup.objectKey = null;
      await this.backupRepository.save(backup);
    }
  }

  private assertReady(): void {
    if (!this.isEnabled()) throw new Error('Platform backups are disabled');
    if (!this.objectStorage.isConfigured())
      throw new Error('Off-site backup storage is not configured');
    this.getEncryptionKey(true);
  }

  private isReady(): boolean {
    return (
      this.isEnabled() &&
      this.objectStorage.isConfigured() &&
      this.getEncryptionKey(false).length === 32
    );
  }

  private isEnabled(): boolean {
    return this.configService.get<string>('BACKUP_ENABLED') === 'true';
  }

  private getRetentionDays(): number {
    const value = Number(this.configService.get<string>('BACKUP_RETENTION_DAYS', '30'));
    return Number.isSafeInteger(value) && value >= 7 && value <= 365 ? value : 30;
  }

  private getEncryptionKey(required: boolean): Buffer {
    const raw = this.configService.get<string>('BACKUP_ENCRYPTION_KEY');
    const key = raw && /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.alloc(0);
    if (required && key.length !== 32) {
      throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
    }
    return key;
  }

  private getEncryptionKeyId(): string {
    return createHash('sha256').update(this.getEncryptionKey(true)).digest('hex').slice(0, 16);
  }
}
