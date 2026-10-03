import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IsNull, Repository } from 'typeorm';
import { WhatsappSettings } from '../../admin/entities/whatsapp-settings.entity';
import { WhatsAppService } from './whatsapp.service';

describe('WhatsAppService webhook verification', () => {
  const createService = (
    envToken: string | undefined,
    databaseToken: string | undefined,
  ): { service: WhatsAppService; findOne: jest.Mock } => {
    const findOne = jest.fn().mockResolvedValue(
      databaseToken ? { webhookVerifyToken: databaseToken } : null,
    );
    const service = new WhatsAppService(
      { get: jest.fn().mockReturnValue(envToken) } as unknown as ConfigService,
      {} as HttpService,
      {} as EventEmitter2,
      { findOne } as unknown as Repository<WhatsappSettings>,
    );
    return { service, findOne };
  };

  it('accepts the active global database token configured from the admin page', async () => {
    const { service, findOne } = createService(undefined, 'database-secret');

    await expect(service.verifyWebhook('subscribe', 'database-secret', 'challenge')).resolves.toBe('challenge');
    expect(findOne).toHaveBeenCalledWith({
      where: { tenantId: IsNull(), isActive: true },
      select: ['webhookVerifyToken'],
    });
  });

  it('keeps the environment token compatible and rejects empty or incorrect tokens', async () => {
    const { service } = createService('environment-secret', undefined);

    await expect(service.verifyWebhook('subscribe', 'environment-secret', 'challenge')).resolves.toBe('challenge');
    await expect(service.verifyWebhook('subscribe', '', 'challenge')).resolves.toBeNull();
    await expect(service.verifyWebhook('subscribe', 'wrong-secret', 'challenge')).resolves.toBeNull();
  });
});
