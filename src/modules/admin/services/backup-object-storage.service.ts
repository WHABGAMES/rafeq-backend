import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'fs';

interface StorageConfig {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

@Injectable()
export class BackupObjectStorageService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    try {
      this.getConfig();
      return true;
    } catch {
      return false;
    }
  }

  async putFile(
    objectKey: string,
    filePath: string,
    size: number,
    sha256: string,
    encryptionKeyId: string,
  ): Promise<void> {
    const config = this.getConfig();
    const upload = new Upload({
      client: this.createClient(config),
      params: {
        Bucket: config.bucket,
        Key: objectKey,
        Body: createReadStream(filePath),
        ContentLength: size,
        ContentType: 'application/octet-stream',
        ACL: 'private',
        Metadata: { sha256, 'encryption-key-id': encryptionKeyId },
      },
      // Multipart upload supports backups above the S3 single-PUT limit and
      // automatically aborts incomplete uploads when a part fails.
      partSize: 16 * 1024 * 1024,
      queueSize: 2,
      leavePartsOnError: false,
    });
    await upload.done();
  }

  async deleteObject(objectKey: string): Promise<void> {
    const config = this.getConfig();
    await this.createClient(config).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  }

  async assertObjectIntegrity(
    objectKey: string,
    expectedSize: number,
    expectedSha256: string,
    expectedEncryptionKeyId: string,
  ): Promise<void> {
    const config = this.getConfig();
    const response = await this.createClient(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
    const storedSize = response.ContentLength;
    const storedSha256 = String(response.Metadata?.sha256 || '').toLowerCase();
    const storedKeyId = String(response.Metadata?.['encryption-key-id'] || '');
    if (
      !Number.isSafeInteger(storedSize) ||
      storedSize !== expectedSize ||
      storedSha256 !== expectedSha256.toLowerCase() ||
      storedKeyId !== expectedEncryptionKeyId
    ) {
      throw new Error(
        'Backup upload verification failed: remote size or SHA-256 metadata does not match',
      );
    }
  }

  private createClient(config: StorageConfig): S3Client {
    return new S3Client({
      endpoint: config.endpoint.origin,
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      forcePathStyle: false,
      maxAttempts: 3,
    });
  }

  private getConfig(): StorageConfig {
    const requiredKeys = [
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_REGION',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_ACCESS_KEY',
      'BACKUP_S3_SECRET_KEY',
    ] as const;
    if (requiredKeys.some((key) => !this.configService.get<string>(key)?.trim())) {
      throw new Error('Off-site backup storage is not configured');
    }
    const endpoint = new URL(this.configService.getOrThrow<string>('BACKUP_S3_ENDPOINT'));
    const region = this.configService.getOrThrow<string>('BACKUP_S3_REGION').trim();
    const bucket = this.configService.getOrThrow<string>('BACKUP_S3_BUCKET').trim();
    const accessKey = this.configService.getOrThrow<string>('BACKUP_S3_ACCESS_KEY').trim();
    const secretKey = this.configService.getOrThrow<string>('BACKUP_S3_SECRET_KEY').trim();
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    if (
      (isProduction && endpoint.protocol !== 'https:') ||
      !['https:', 'http:'].includes(endpoint.protocol)
    ) {
      throw new Error('Backup storage endpoint must use HTTPS in production');
    }
    if (endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password) {
      throw new Error('Backup storage endpoint must contain only scheme and host');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error('Backup bucket name is not DNS-compatible');
    }
    if (!/^[a-z0-9-]{2,32}$/.test(region)) {
      throw new Error('Backup storage region is invalid');
    }
    return { endpoint, region, bucket, accessKey, secretKey };
  }
}
