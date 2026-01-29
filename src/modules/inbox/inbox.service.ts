/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Inbox Service                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Conversation, Message, User } from '@database/entities';
import {
  ConversationStatus,
  ConversationPriority,
} from '@database/entities/conversation.entity';

// Re-export for controller
export { ConversationStatus, ConversationPriority };

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📌 Types
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface InboxFilters {
  status?: ConversationStatus;
  channel?: string;
  assignedTo?: string | null;
  priority?: ConversationPriority;
  tags?: string[];
  search?: string;
  unreadOnly?: boolean;
}

export interface InboxStats {
  total: number;
  unread: number;
  pending: number;
  assignedToMe: number;
  unassigned: number;
  avgResponseTime: number;
  avgResolutionTime: number;
}

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getConversations(
    tenantId: string,
    filters: InboxFilters = {},
    pagination = { page: 1, limit: 20 },
  ) {
    const queryBuilder = this.conversationRepository
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.channel', 'channel')
      .leftJoinAndSelect('conv.assignedTo', 'agent')
      .where('conv.tenantId = :tenantId', { tenantId });

    if (filters.status) {
      queryBuilder.andWhere('conv.status = :status', {
        status: filters.status,
      });
    }

    if (filters.channel) {
      queryBuilder.andWhere('conv.channelId = :channel', {
        channel: filters.channel,
      });
    }

    if (filters.assignedTo === null) {
      queryBuilder.andWhere('conv.assignedToId IS NULL');
    } else if (filters.assignedTo) {
      queryBuilder.andWhere('conv.assignedToId = :assignedTo', {
        assignedTo: filters.assignedTo,
      });
    }

    if (filters.priority) {
      queryBuilder.andWhere('conv.priority = :priority', {
        priority: filters.priority,
      });
    }

    if (filters.tags && filters.tags.length > 0) {
      queryBuilder.andWhere('conv.tags && :tags', { tags: filters.tags });
    }

    if (filters.search) {
      queryBuilder.andWhere(
        '(conv.customerName ILIKE :search OR conv.customerPhone ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters.unreadOnly) {
      queryBuilder.andWhere('conv.messagesCount > 0');
    }

    const [items, total] = await queryBuilder
      .orderBy('conv.lastMessageAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit)
      .getManyAndCount();

    return {
      items,
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async getConversation(id: string, tenantId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id, tenantId },
      relations: ['channel', 'assignedTo'],
    });

    if (!conversation) {
      throw new NotFoundException('المحادثة غير موجودة');
    }

    const messages = await this.messageRepository.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
      take: 100,
    });

    return {
      ...conversation,
      messages,
    };
  }

  async getStats(tenantId: string, userId?: string): Promise<InboxStats> {
    const baseQuery = this.conversationRepository
      .createQueryBuilder('conv')
      .where('conv.tenantId = :tenantId', { tenantId })
      .andWhere('conv.status NOT IN (:...closedStatuses)', {
        closedStatuses: [ConversationStatus.CLOSED],
      });

    const [total, unread, pending, unassigned] = await Promise.all([
      baseQuery.clone().getCount(),
      baseQuery.clone().andWhere('conv.messagesCount > 0').getCount(),
      baseQuery
        .clone()
        .andWhere('conv.status = :pendingStatus', {
          pendingStatus: ConversationStatus.PENDING,
        })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('conv.assignedToId IS NULL')
        .getCount(),
    ]);

    let assignedToMe = 0;
    if (userId) {
      assignedToMe = await baseQuery
        .clone()
        .andWhere('conv.assignedToId = :userId', { userId })
        .getCount();
    }

    const avgResponseTime = 5;
    const avgResolutionTime = 30;

    return {
      total,
      unread,
      pending,
      assignedToMe,
      unassigned,
      avgResponseTime,
      avgResolutionTime,
    };
  }

  async assignToAgent(
    id: string,
    agentId: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const agent = await this.userRepository.findOne({
      where: { id: agentId, tenantId },
    });

    if (!agent) {
      throw new NotFoundException('الموظف غير موجود');
    }

    conversation.assignedToId = agentId;
    conversation.status = ConversationStatus.ASSIGNED;

    return this.conversationRepository.save(conversation);
  }

  async unassign(id: string, tenantId: string): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    conversation.assignedToId = undefined;
    conversation.status = ConversationStatus.PENDING;

    return this.conversationRepository.save(conversation);
  }

  async updateStatus(
    id: string,
    status: ConversationStatus,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    conversation.status = status;

    if (status === ConversationStatus.RESOLVED) {
      conversation.resolvedAt = new Date();
    }

    return this.conversationRepository.save(conversation);
  }

  async updatePriority(
    id: string,
    priority: ConversationPriority,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    conversation.priority = priority;

    return this.conversationRepository.save(conversation);
  }

  async addTags(
    id: string,
    tags: string[],
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const currentTags = conversation.tags || [];
    conversation.tags = [...new Set([...currentTags, ...tags])];

    return this.conversationRepository.save(conversation);
  }

  async removeTag(
    id: string,
    tag: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const currentTags = conversation.tags || [];
    conversation.tags = currentTags.filter((t) => t !== tag);

    return this.conversationRepository.save(conversation);
  }

  async addNote(
    id: string,
    note: string,
    userId: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.getConversationById(id, tenantId);

    const currentNotes = conversation.notes || '';
    const timestamp = new Date().toISOString();
    conversation.notes = currentNotes + `\n[${timestamp}] ${userId}: ${note}`;

    return this.conversationRepository.save(conversation);
  }

  async markAsRead(id: string, tenantId: string): Promise<void> {
    await this.conversationRepository.update(
      { id, tenantId },
      { messagesCount: 0 },
    );
  }

  private async getConversationById(
    id: string,
    tenantId: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepository.findOne({
      where: { id, tenantId },
    });

    if (!conversation) {
      throw new NotFoundException('المحادثة غير موجودة');
    }

    return conversation;
  }
}
