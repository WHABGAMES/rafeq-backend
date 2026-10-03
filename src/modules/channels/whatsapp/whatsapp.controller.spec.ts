import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Channel, ChannelType } from '../entities/channel.entity';
import { WhatsappSettings } from '../../admin/entities/whatsapp-settings.entity';
import { WhatsAppService, WhatsAppWebhookPayload } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';

describe('WhatsAppController durable webhook acknowledgement', () => {
  const payload: WhatsAppWebhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-id',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            phone_number_id: 'store-phone-id',
            display_phone_number: '+966500000000',
          },
        },
      }],
    }],
  };

  const createResponse = () => {
    const response = {
      headersSent: false,
      status: jest.fn(),
      send: jest.fn(),
    };
    response.status.mockReturnValue(response);
    response.send.mockImplementation(() => {
      response.headersSent = true;
      return response;
    });
    return response;
  };

  const createController = (processWebhook: jest.Mock) => {
    const channelRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'store-channel' }),
      increment: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new WhatsAppController(
      { processWebhook } as unknown as WhatsAppService,
      { get: jest.fn((_key: string) => undefined) } as unknown as ConfigService,
      channelRepository as unknown as Repository<Channel>,
      {} as Repository<WhatsappSettings>,
      {} as DataSource,
    );
    return { controller, channelRepository };
  };

  it('acknowledges only after the store webhook has been persisted', async () => {
    const processWebhook = jest.fn().mockResolvedValue(undefined);
    const { controller, channelRepository } = createController(processWebhook);
    const response = createResponse();

    await controller.handleWebhook(
      payload,
      { headers: {}, rawBody: undefined } as never,
      response as never,
    );

    expect(processWebhook).toHaveBeenCalledWith(payload, 'store-channel');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith('EVENT_RECEIVED');
    expect(channelRepository.findOne).toHaveBeenCalledWith({
      where: {
        whatsappPhoneNumberId: 'store-phone-id',
        type: ChannelType.WHATSAPP_OFFICIAL,
        isAdminChannel: false,
      },
    });
  });

  it('returns 500 when persistence fails so Meta can retry the event', async () => {
    const processWebhook = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const { controller } = createController(processWebhook);
    const response = createResponse();

    await controller.handleWebhook(
      payload,
      { headers: {}, rawBody: undefined } as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.send).toHaveBeenCalledWith('PERSISTENCE_FAILED');
  });
});
