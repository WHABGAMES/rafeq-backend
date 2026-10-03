import { createDecipheriv, createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { open, rename, rm, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';

const MAGIC = Buffer.from('RFBACK01');
const HEADER_LENGTH = MAGIC.length + 12;
const AUTH_TAG_LENGTH = 16;

export interface DecryptBackupOptions {
  input: string;
  output: string;
  encryptionKey: string;
  expectedSha256?: string;
}

export async function decryptPlatformBackup(options: DecryptBackupOptions): Promise<void> {
  const key = parseKey(options.encryptionKey);
  const fileStat = await stat(options.input);
  if (fileStat.size <= HEADER_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Backup file is too small to contain a valid encrypted dump');
  }
  if (options.expectedSha256) {
    const actual = await hashFile(options.input);
    if (actual !== options.expectedSha256.toLowerCase()) {
      throw new Error('Backup SHA-256 verification failed');
    }
  }

  const handle = await open(options.input, 'r');
  const header = Buffer.alloc(HEADER_LENGTH);
  const authTag = Buffer.alloc(AUTH_TAG_LENGTH);
  try {
    await handle.read(header, 0, HEADER_LENGTH, 0);
    await handle.read(authTag, 0, AUTH_TAG_LENGTH, fileStat.size - AUTH_TAG_LENGTH);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Unsupported backup format or invalid magic header');
  }

  const partialOutput = `${options.output}.partial`;
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(authTag);
  try {
    await pipeline(
      createReadStream(options.input, {
        start: HEADER_LENGTH,
        end: fileStat.size - AUTH_TAG_LENGTH - 1,
      }),
      decipher,
      createWriteStream(partialOutput, { flags: 'wx', mode: 0o600 }),
    );
    await rename(partialOutput, options.output);
  } catch (error) {
    await rm(partialOutput, { force: true });
    throw error;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

function parseKey(raw: string): Buffer {
  if (!/^[a-f\d]{64}$/i.test(raw)) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
  }
  return Buffer.from(raw, 'hex');
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (require.main === module) {
  const input = readArgument('--input');
  const output = readArgument('--output');
  const expectedSha256 = readArgument('--sha256');
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  if (!input || !output || !encryptionKey) {
    console.error(
      'Usage: BACKUP_ENCRYPTION_KEY=<64 hex> node dist/cli/decrypt-platform-backup.js --input <file> --output <dump> [--sha256 <digest>]',
    );
    process.exitCode = 1;
  } else {
    decryptPlatformBackup({ input, output, encryptionKey, expectedSha256 })
      .then(() => console.log('Backup decrypted and authenticated successfully'))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : 'Backup decryption failed');
        process.exitCode = 1;
      });
  }
}
