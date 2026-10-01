import { ConfigService } from '@nestjs/config';
import { AdminTwoFactorSecretService } from './admin-two-factor-secret.service';

describe('AdminTwoFactorSecretService', () => {
  const key = 'ab'.repeat(32);

  it('encrypts with authenticated encryption and restores the secret', () => {
    const service = new AdminTwoFactorSecretService(new ConfigService({
      NODE_ENV: 'test',
      ADMIN_2FA_ENCRYPTION_KEY: key,
    }));
    const encrypted = service.encrypt('JBSWY3DPEHPK3PXP');

    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(service.isEncrypted(encrypted)).toBe(true);
    expect(service.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('reads legacy plaintext during migration', () => {
    const service = new AdminTwoFactorSecretService(new ConfigService({
      NODE_ENV: 'test',
      ADMIN_2FA_ENCRYPTION_KEY: key,
    }));
    expect(service.decrypt('LEGACYBASE32')).toBe('LEGACYBASE32');
    expect(service.isEncrypted('LEGACYBASE32')).toBe(false);
  });

  it('requires an independent valid key in production', () => {
    expect(() => new AdminTwoFactorSecretService(new ConfigService({ NODE_ENV: 'production' }))).toThrow(
      'ADMIN_2FA_ENCRYPTION_KEY is required',
    );
  });
});
