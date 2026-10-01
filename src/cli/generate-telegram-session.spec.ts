import { readTelegramCredentials } from './generate-telegram-session';

describe('Telegram session generator configuration', () => {
  it('accepts valid Telegram API credentials without reading a previous session', () => {
    expect(readTelegramCredentials({
      TELEGRAM_API_ID: '12345',
      TELEGRAM_API_HASH: ' api-hash ',
      TELEGRAM_SESSION: 'must-not-be-read',
    })).toEqual({ apiId: 12345, apiHash: 'api-hash' });
  });

  it.each([undefined, '', '0', '-1', 'not-a-number', '1.5'])(
    'rejects invalid TELEGRAM_API_ID %p',
    (apiId) => {
      expect(() => readTelegramCredentials({
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: 'api-hash',
      })).toThrow('TELEGRAM_API_ID must be a positive integer');
    },
  );

  it('rejects a missing TELEGRAM_API_HASH', () => {
    expect(() => readTelegramCredentials({ TELEGRAM_API_ID: '12345' }))
      .toThrow('TELEGRAM_API_HASH is required');
  });
});
