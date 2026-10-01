import { NotFoundException } from '@nestjs/common';
jest.mock('@modules/inbox/inbox.service', () => ({ InboxService: class InboxService {} }));
import { AdminInboxController } from './admin-inbox.controller';

describe('AdminInboxController conversation isolation', () => {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const conversationRepo = { createQueryBuilder: jest.fn(() => queryBuilder) };
  const messageRepo = {};
  const channelRepo = { find: jest.fn() };
  const whatsappSettingsRepo = { findOne: jest.fn() };
  const inboxService = { getMessages: jest.fn() };
  const whatsappSettingsService = {};
  const controller = new AdminInboxController(
    conversationRepo as never,
    messageRepo as never,
    channelRepo as never,
    whatsappSettingsRepo as never,
    inboxService as never,
    whatsappSettingsService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rejects a conversation outside the configured admin channels', async () => {
    whatsappSettingsRepo.findOne.mockResolvedValue({ phoneNumberId: 'admin-phone' });
    channelRepo.find.mockResolvedValue([{ id: 'admin-channel' }]);
    queryBuilder.getOne.mockResolvedValue(null);

    await expect(controller.getMessages('foreign-conversation', 1, 50))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'conversation.channelId IN (:...channelIds)',
      { channelIds: ['admin-channel'] },
    );
    expect(inboxService.getMessages).not.toHaveBeenCalled();
  });

  it('passes the verified conversation tenant to the inbox service', async () => {
    whatsappSettingsRepo.findOne.mockResolvedValue({ phoneNumberId: 'admin-phone' });
    channelRepo.find.mockResolvedValue([{ id: 'admin-channel' }]);
    queryBuilder.getOne.mockResolvedValue({ id: 'conversation', tenantId: 'tenant' });
    inboxService.getMessages.mockResolvedValue({ items: [] });

    await controller.getMessages('conversation', 1, 50);
    expect(inboxService.getMessages).toHaveBeenCalledWith('conversation', 'tenant', { page: 1, limit: 50 });
  });
});
