import { BadRequestException } from '@nestjs/common';
import { MessageChannel, MessageLanguage, TriggerEvent } from '../entities/message-template.entity';
import { NotificationService } from './notification.service';

describe('NotificationService template delivery', () => {
  const templateRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: object) => value),
    save: jest.fn((value: object) => Promise.resolve({ id: 'saved-template', ...value })),
  };
  const notificationQueue = { add: jest.fn() };
  const dataSource = { query: jest.fn() };
  const service = new NotificationService(
    templateRepository as never,
    notificationQueue as never,
    dataSource as never,
  );

  const bothTemplate = {
    id: 'template-1',
    name: 'Both channels',
    triggerEvent: TriggerEvent.NEW_MERCHANT_REGISTERED,
    channel: MessageChannel.BOTH,
    language: MessageLanguage.AR,
    content: 'مرحباً {{merchant_name}}',
    subject: 'مرحباً {{merchant_name}}',
    isActive: true,
    version: 1,
    versionHistory: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    notificationQueue.add.mockReset();
    notificationQueue.add
      .mockResolvedValueOnce({ id: 'job-whatsapp' })
      .mockResolvedValueOnce({ id: 'job-email' });
  });

  it('queues independent jobs for both channels to prevent cross-channel duplicate retries', async () => {
    templateRepository.findOne.mockResolvedValue(bothTemplate);

    const result = await service.sendManual(
      bothTemplate.id,
      '+966500000000',
      { merchant_name: 'أحمد' },
      { recipientEmail: 'merchant@example.com' },
    );

    expect(notificationQueue.add).toHaveBeenCalledTimes(2);
    expect(notificationQueue.add.mock.calls[0][1]).toEqual(expect.objectContaining({
      channel: MessageChannel.WHATSAPP,
      recipientPhone: '+966500000000',
    }));
    expect(notificationQueue.add.mock.calls[1][1]).toEqual(expect.objectContaining({
      channel: MessageChannel.EMAIL,
      recipientEmail: 'merchant@example.com',
      subject: 'مرحباً أحمد',
    }));
    expect(result.channels).toEqual([MessageChannel.WHATSAPP, MessageChannel.EMAIL]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('rejects a test send when a required channel recipient is missing', async () => {
    templateRepository.findOne.mockResolvedValue(bothTemplate);

    await expect(service.sendManual(
      bothTemplate.id,
      '+966500000000',
      {},
    )).rejects.toThrow(BadRequestException);
    expect(notificationQueue.add).not.toHaveBeenCalled();
  });

  it('dispatches every active template for the event instead of silently choosing one', async () => {
    templateRepository.find.mockResolvedValue([
      { ...bothTemplate, id: 'wa', channel: MessageChannel.WHATSAPP },
      { ...bothTemplate, id: 'email', channel: MessageChannel.EMAIL },
    ]);

    await service.sendByTriggerEvent(
      TriggerEvent.NEW_MERCHANT_REGISTERED,
      '+966500000000',
      { merchant_name: 'أحمد' },
      { recipientEmail: 'merchant@example.com' },
    );

    expect(notificationQueue.add).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown placeholders instead of silently stripping authoring mistakes', async () => {
    await expect(service.createTemplate({
      name: 'Invalid template',
      triggerEvent: TriggerEvent.CUSTOM_MANUAL_SEND,
      channel: MessageChannel.WHATSAPP,
      language: MessageLanguage.AR,
      content: 'مرحباً {{merchant_nam_typo}}',
      isActive: false,
    }, 'admin-1')).rejects.toThrow('متغيرات غير مدعومة');
    expect(templateRepository.save).not.toHaveBeenCalled();
  });
});
