import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTED_PREFIX = 'v1';

@Injectable()
export class AdminTwoFactorSecretService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const configuredKey = config.get<string>('ADMIN_2FA_ENCRYPTION_KEY')?.trim();
    const isProduction = config.get<string>('NODE_ENV') === 'production';

    if (!configuredKey && isProduction) {
      throw new Error('ADMIN_2FA_ENCRYPTION_KEY is required in production');
    }

    const keyHex = configuredKey || 'f0'.repeat(32);
    if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
      throw new Error('ADMIN_2FA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
    }
    this.key = Buffer.from(keyHex, 'hex');
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENCRYPTED_PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(storedSecret: string): string {
    if (!this.isEncrypted(storedSecret)) return storedSecret;
    const [, ivPart, tagPart, ciphertextPart] = storedSecret.split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  isEncrypted(storedSecret: string): boolean {
    return storedSecret.startsWith(`${ENCRYPTED_PREFIX}.`);
  }
}
