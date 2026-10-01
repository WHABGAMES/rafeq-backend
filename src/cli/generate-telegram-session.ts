import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

export function readTelegramCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): TelegramCredentials {
  const apiId = Number(environment.TELEGRAM_API_ID);
  const apiHash = environment.TELEGRAM_API_HASH?.trim() ?? '';

  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    throw new Error('TELEGRAM_API_ID must be a positive integer');
  }
  if (!apiHash) {
    throw new Error('TELEGRAM_API_HASH is required');
  }

  return { apiId, apiHash };
}

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Telegram 2FA password requires an interactive terminal');
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const restore = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };

    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\u0003') {
          restore();
          reject(new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          restore();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdin.on('data', onData);
  });
}

export async function generateTelegramSession(): Promise<string> {
  const { apiId, apiHash } = readTelegramCredentials();
  const prompts = createInterface({ input: stdin, output: stdout });
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () => (await prompts.question('Telegram phone number (international format): ')).trim(),
      phoneCode: async () => (await prompts.question('Telegram verification code: ')).trim(),
      password: async () => {
        prompts.pause();
        try {
          return await readHidden('Telegram 2FA password: ');
        } finally {
          prompts.resume();
        }
      },
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Telegram authorization error: ${message}`);
      },
    });

    const identity = await client.getMe();
    if (!identity) {
      throw new Error('Telegram authorization completed without an authenticated identity');
    }

    const generatedSession = session.save();
    if (!generatedSession) {
      throw new Error('Telegram returned an empty session');
    }

    return generatedSession;
  } finally {
    prompts.close();
    try {
      await client.disconnect();
    } catch {
      // Disconnect is best-effort when authorization fails before connection.
    }
  }
}

async function main(): Promise<void> {
  console.log('Creating a new Telegram session. The old TELEGRAM_SESSION is never read or reused.');
  const session = await generateTelegramSession();
  console.log('\nCopy the value below into DigitalOcean as encrypted TELEGRAM_SESSION.');
  console.log('Do not save it in Git, chat, screenshots, or shell history.\n');
  console.log('----- TELEGRAM_SESSION START -----');
  console.log(session);
  console.log('----- TELEGRAM_SESSION END -----');
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to generate Telegram session: ${message}`);
    process.exitCode = 1;
  });
}
