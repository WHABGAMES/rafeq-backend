import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Conversation, Message, User } from '@database/entities';
import { MessageService } from '../messaging/services/message.service';
import { InboxService } from './inbox.service';

jest.mock('../messaging/services/message.service', () => ({
  MessageService: class MessageService {},
}));

describe('InboxService admin-channel isolation', () => {
  const createQueryBuilder = (result: Conversation | null = null) => {
    const builder = {
      leftJoinAndSelect: jest.fn(),
      innerJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getOne: jest.fn().mockResolvedValue(result),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    for (const method of ['leftJoinAndSelect', 'innerJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take'] as const) {
      builder[method].mockReturnValue(builder);
    }
    return builder;
  };

  const createService = (builder: ReturnType<typeof createQueryBuilder>) => {
    const conversations = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      manager: { query: jest.fn() },
    } as unknown as Repository<Conversation>;
    return new InboxService(
      conversations,
      {} as Repository<Message>,
      {} as Repository<User>,
      {} as MessageService,
    );
  };

  it('excludes admin channels from the tenant conversation list', async () => {
    const builder = createQueryBuilder();
    const service = createService(builder);

    await expect(service.getConversations('tenant-1')).resolves.toEqual({
      conversations: [],
      total: 0,
    });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'COALESCE(channel.isAdminChannel, false) = false',
    );
  });

  it('treats an admin conversation as not found for tenant message access', async () => {
    const builder = createQueryBuilder(null);
    const service = createService(builder);

    await expect(service.getMessages('admin-conversation', 'tenant-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'COALESCE(channel.isAdminChannel, false) = false',
    );
  });
});
