import { NotFoundException } from '@nestjs/common';
import { AdminInboxController } from './admin-inbox.controller';

describe('AdminInboxController conversation isolation', () => {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const conversationRepo = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const messageQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const messageRepo = {
    createQueryBuilder: jest.fn(() => messageQueryBuilder),
    count: jest.fn(),
  };
  const channelRepo = { find: jest.fn() };
  const whatsappSettingsRepo = { findOne: jest.fn() };
  const whatsappSettingsService = { sendMessage: jest.fn() };
  const controller = new AdminInboxController(
    conversationRepo as never,
    messageRepo as never,
    channelRepo as never,
    whatsappSettingsRepo as never,
    whatsappSettingsService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects a conversation outside the configured admin channels', async () => {
    whatsappSettingsRepo.findOne.mockResolvedValue({ phoneNumberId: 'admin-phone' });
    channelRepo.find.mockResolvedValue([{ id: 'admin-channel' }]);
    queryBuilder.getOne.mockResolvedValue(null);

    await expect(controller.getMessages('foreign-conversation', 50))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'conversation.channelId IN (:...channelIds)',
      { channelIds: ['admin-channel'] },
    );
    expect(messageRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('loads messages only after verifying the conversation is on an admin channel', async () => {
    whatsappSettingsRepo.findOne.mockResolvedValue({ phoneNumberId: 'admin-phone' });
    channelRepo.find.mockResolvedValue([{ id: 'admin-channel' }]);
    queryBuilder.getOne.mockResolvedValue({ id: 'conversation', tenantId: 'tenant' });
    messageQueryBuilder.getMany.mockResolvedValue([]);
    messageRepo.count.mockResolvedValue(0);

    await expect(controller.getMessages('conversation', 50)).resolves.toEqual({
      messages: [],
      total: 0,
      nextCursor: null,
    });
    expect(messageQueryBuilder.orderBy).toHaveBeenCalledWith('message.createdAt', 'DESC');
    expect(messageQueryBuilder.addOrderBy).toHaveBeenCalledWith('message.id', 'DESC');
    expect(messageQueryBuilder.take).toHaveBeenCalledWith(50);
  });

  it('sends operational inbox replies through the configured admin WhatsApp channel', async () => {
    whatsappSettingsRepo.findOne.mockResolvedValue({ phoneNumberId: 'admin-phone' });
    channelRepo.find.mockResolvedValue([{ id: 'admin-channel' }]);
    queryBuilder.getOne.mockResolvedValue({
      id: 'conversation',
      tenantId: 'tenant',
      customerPhone: '971561667877',
    });
    whatsappSettingsService.sendMessage.mockResolvedValue({
      success: true,
      messageLogId: 'log-id',
      savedMessageId: 'message-id',
    });

    await expect(controller.sendMessage(
      'conversation',
      {} as never,
      { content: ' مرحباً ' },
    )).resolves.toMatchObject({
      id: 'message-id',
      conversationId: 'conversation',
      content: 'مرحباً',
      status: 'sent',
    });
    expect(whatsappSettingsService.sendMessage).toHaveBeenCalledWith(
      '971561667877',
      'مرحباً',
      { recipientUserId: undefined, triggerEvent: 'admin.manual' },
    );
  });
});
