import { createCipheriv, createHash, randomBytes } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { decryptPlatformBackup } from './decrypt-platform-backup';

describe('decryptPlatformBackup', () => {
  const keyHex = 'cd'.repeat(32);
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rafeq-backup-decrypt-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('verifies checksum and GCM authentication before producing a dump', async () => {
    const plaintext = Buffer.from('valid custom-format pg dump fixture');
    const encrypted = encryptFixture(plaintext, Buffer.from(keyHex, 'hex'));
    const input = join(directory, 'backup.enc');
    const output = join(directory, 'backup.dump');
    await writeFile(input, encrypted);

    await decryptPlatformBackup({
      input,
      output,
      encryptionKey: keyHex,
      expectedSha256: createHash('sha256').update(encrypted).digest('hex'),
    });

    await expect(readFile(output)).resolves.toEqual(plaintext);
  });

  it('rejects a modified backup and leaves no partial output', async () => {
    const encrypted = encryptFixture(Buffer.from('sensitive data'), Buffer.from(keyHex, 'hex'));
    encrypted[25] ^= 1;
    const input = join(directory, 'tampered.enc');
    const output = join(directory, 'tampered.dump');
    await writeFile(input, encrypted);

    await expect(decryptPlatformBackup({ input, output, encryptionKey: keyHex })).rejects.toThrow();
    await expect(readFile(output)).rejects.toThrow();
    await expect(readFile(`${output}.partial`)).rejects.toThrow();
  });
});

function encryptFixture(plaintext: Buffer, key: Buffer): Buffer {
  const magic = Buffer.from('RFBACK01');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([magic, iv, ciphertext, cipher.getAuthTag()]);
}
