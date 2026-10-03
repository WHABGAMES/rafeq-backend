import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes, scryptSync } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { MailService } from '../../mail/mail.service';
import { MessageLog } from '../entities/message-log.entity';
import { WhatsappProvider, WhatsappSettings } from '../entities/whatsapp-settings.entity';
import { WhatsappSettingsService } from './whatsapp-settings.service';

describe('WhatsappSettingsService settings persistence', () => {
  const encryptForTest = (value: string): string => {
    const iv = randomBytes(16);
    const key = scryptSync('test-encryption-key', 'rafeq-salt-v1', 32);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  };

  const existing = Object.assign(new WhatsappSettings(), {
    id: '45fdd71a-0730-4bf3-b59d-3cab208cf631',
    phoneNumber: '+966500000000',
    provider: WhatsappProvider.META,
    phoneNumberId: 'old-phone-id',
    accessTokenEncrypted: '0123456789abcdef0123456789abcdef:00',
    isActive: true,
    connectionStatus: 'connected',
    consecutiveHealthFailures: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  });

  it('preserves the stored token when an update omits accessToken and never returns it', async () => {
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async (settings: WhatsappSettings) => settings),
      create: jest.fn(),
    } as unknown as Repository<WhatsappSettings>;
    const syncQuery = jest.fn()
      .mockResolvedValueOnce([{ id: 'admin-channel-id', is_admin_channel: true }])
      .mockResolvedValueOnce([]);
    const service = new WhatsappSettingsService(
      settingsRepo,
      {} as Repository<MessageLog>,
      { query: syncQuery } as unknown as DataSource,
      { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService,
      {} as MailService,
    );

    const result = await service.upsertSettings({
      phoneNumber: '+966511111111',
      provider: WhatsappProvider.META,
      phoneNumberId: 'new-phone-id',
    });

    expect(existing.accessTokenEncrypted).toBe('0123456789abcdef0123456789abcdef:00');
    expect(result).not.toHaveProperty('accessTokenEncrypted');
    expect(result.hasAccessToken).toBe(true);
    expect(result.maskedToken).toBe('•••••••• (محفوظ)');
    expect(result.lastConfiguredAt).toBeInstanceOf(Date);
    expect(syncQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SET is_admin_channel = true'),
      ['admin-channel-id', '+966511111111', null],
    );
  });

  it('alerts the owner only after three consecutive Meta health failures', async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    const monitored = Object.assign(new WhatsappSettings(), {
      ...existing,
      accessTokenEncrypted: encryptForTest('meta-token-for-test'),
      phoneNumberId: '123456789',
      connectionStatus: 'connected',
      consecutiveHealthFailures: 0,
      lastDisconnectAlertAt: null,
      lastConfiguredAt: new Date('2026-10-01T12:00:00.000Z'),
    });
    const settingsRepo = {
      find: jest.fn().mockResolvedValue([monitored]),
      save: jest.fn(async (settings: WhatsappSettings) => settings),
    } as unknown as Repository<WhatsappSettings>;
    const lockQuery = jest.fn().mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('pg_try_advisory_lock') ? [{ acquired: true }] : [{ unlocked: true }]),
    );
    const dataSource = {
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query: lockQuery,
        release: jest.fn().mockResolvedValue(undefined),
      })),
    } as unknown as DataSource;
    const sendMail = jest.fn().mockResolvedValue(true);
    const service = new WhatsappSettingsService(
      settingsRepo,
      {} as Repository<MessageLog>,
      dataSource,
      {
        get: jest.fn((key: string, fallback?: string) => {
          if (key === 'BCC_EMAIL') return 'owner@example.com';
          return fallback;
        }),
      } as unknown as ConfigService,
      { sendMail } as unknown as MailService,
    );
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Token expired' } }),
    }) as unknown as typeof fetch;

    try {
      await service.monitorConnections();
      await service.monitorConnections();
      expect(sendMail).not.toHaveBeenCalled();

      await service.monitorConnections();
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com' }));
      expect(monitored.connectionStatus).toBe('disconnected');
      expect(monitored.consecutiveHealthFailures).toBe(3);
      expect(monitored.lastConfiguredAt).toEqual(new Date('2026-10-01T12:00:00.000Z'));
      expect(settingsRepo.find).toHaveBeenCalledWith({
        where: {
          isActive: true,
          provider: WhatsappProvider.META,
          tenantId: IsNull(),
        },
      });
      expect(lockQuery).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [742_610_307],
      );
      expect(lockQuery).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1)',
        [742_610_307],
      );
    } finally {
      global.fetch = originalFetch;
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it('normalizes the Meta recipient and records a successful test only after Meta accepts it', async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    const configured = Object.assign(new WhatsappSettings(), {
      ...existing,
      accessTokenEncrypted: encryptForTest('meta-token-for-test'),
      phoneNumberId: '123456789',
      lastTestSentAt: undefined,
    });
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(configured),
      save: jest.fn(async (settings: WhatsappSettings) => settings),
    } as unknown as Repository<WhatsappSettings>;
    const service = new WhatsappSettingsService(
      settingsRepo,
      {} as Repository<MessageLog>,
      {} as DataSource,
      { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService,
      {} as MailService,
    );
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.test' }] }),
    }) as unknown as typeof fetch;

    try {
      await expect(service.sendTestMessage('+966 57 949 9572')).resolves.toEqual({
        success: true,
        message: 'Test message sent successfully',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/123456789/messages'),
        expect.objectContaining({
          body: expect.stringContaining('"to":"966579499572"'),
        }),
      );
      expect(configured.lastTestSentAt).toBeInstanceOf(Date);
      expect(configured.connectionStatus).toBe('connected');
    } finally {
      global.fetch = originalFetch;
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it('does not mark the integration disconnected when Meta rejects a test message', async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key';
    const previousTestAt = new Date('2026-10-01T08:00:00.000Z');
    const configured = Object.assign(new WhatsappSettings(), {
      ...existing,
      accessTokenEncrypted: encryptForTest('meta-token-for-test'),
      phoneNumberId: '123456789',
      connectionStatus: 'connected',
      lastTestSentAt: previousTestAt,
    });
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(configured),
      save: jest.fn(),
    } as unknown as Repository<WhatsappSettings>;
    const service = new WhatsappSettingsService(
      settingsRepo,
      {} as Repository<MessageLog>,
      {} as DataSource,
      { get: jest.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService,
      {} as MailService,
    );
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Outside the customer service window' } }),
    }) as unknown as typeof fetch;

    try {
      const result = await service.sendTestMessage('+966579499572');
      expect(result.success).toBe(false);
      expect(configured.connectionStatus).toBe('connected');
      expect(configured.lastTestSentAt).toBe(previousTestAt);
      expect(settingsRepo.save).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      delete process.env.ENCRYPTION_KEY;
    }
  });
});
