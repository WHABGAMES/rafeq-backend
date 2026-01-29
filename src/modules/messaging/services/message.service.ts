/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Message Service                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

// Entities
import {
  Message,
  MessageDirection,
  MessageType,
  MessageStatus,
  MessageSender,
} from '../../../database/entities/message.entity';
import {
  Conversation,
  ConversationStatus,
  ConversationHandler,
} from '../../../database/entities/conversation.entity';
import { Channel, ChannelType } from '../../../database/entities/channel.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES & TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface IncomingMessageData {
  channelId: string;
  channelType: ChannelType;
  tenantId: string;
  externalMessageId: string;
  type: MessageType;
  content?: string;
  timestamp: Date;
  senderExternalId: string;
  senderName?: string;
  senderPhone?: string;
  media?: {
    url: string;
    mimeType?: string;
    filename?: string;
    size?: number;
    caption?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  interactiveReply?: {
    type: 'button' | 'list_item';
    id: string;
    title: string;
  };
  metadata?: Record<string, unknown>;
}

export interface OutgoingMessageData {
  conversationId: string;
  type: MessageType;
  content?: string;
  sender: MessageSender;
  agentId?: string;
  media?: {
    url: string;
    mimeType?: string;
    filename?: string;
    caption?: string;
  };
  interactive?: {
    type: 'button' | 'list';
    header?: string;
    body?: string;
    footer?: string;
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
  template?: {
    name: string;
    language: string;
    components?: Array<{
      type: string;
      parameters?: Array<{ type: string; text?: string }>;
    }>;
  };
  aiMetadata?: {
    intent?: string;
    confidence?: number;
    toolsCalled?: string[];
    processingTime?: number;
  };
}

export interface MessageFilters {
  tenantId: string;
  conversationId?: string;
  channelId?: string;
  direction?: MessageDirection;
  type?: MessageType;
  status?: MessageStatus;
  sender?: MessageSender;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

export interface MessageStatusUpdate {
  channelType: ChannelType;
  externalMessageId: string;
  status: MessageStatus;
  timestamp: Date;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 MESSAGE SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    
    @InjectQueue('messaging')
    private readonly messagingQueue: Queue,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 PROCESS INCOMING MESSAGE
  // ═══════════════════════════════════════════════════════════════════════════

  async processIncomingMessage(data: IncomingMessageData): Promise<Message> {
    const startTime = Date.now();
    this.logger.log(`📥 Processing incoming message from ${data.channelType}`);

    // 1️⃣ IDEMPOTENCY CHECK
    const existingMessage = await this.messageRepo.findOne({
      where: {
        tenantId: data.tenantId,
        externalId: data.externalMessageId,
      },
    });

    if (existingMessage) {
      this.logger.warn(`⚠️ Duplicate message detected: ${data.externalMessageId}`);
      return existingMessage;
    }

    // 2️⃣ VALIDATE CHANNEL
    const channel = await this.channelRepo.findOne({
      where: {
        id: data.channelId,
        tenantId: data.tenantId,
      },
    });

    if (!channel) {
      throw new NotFoundException(`Channel not found: ${data.channelId}`);
    }

    // 3️⃣ FIND OR CREATE CONVERSATION
    let conversation = await this.conversationRepo.findOne({
      where: {
        tenantId: data.tenantId,
        channelId: data.channelId,
        customerExternalId: data.senderExternalId,
        status: In([
          ConversationStatus.OPEN,
          ConversationStatus.PENDING,
          ConversationStatus.ASSIGNED,
        ]),
      },
    });

    const isNewConversation = !conversation;

    if (isNewConversation) {
      this.logger.log(`📝 Creating new conversation for ${data.senderExternalId}`);
      
      conversation = this.conversationRepo.create({
        tenantId: data.tenantId,
        channelId: data.channelId,
        customerExternalId: data.senderExternalId,
        customerName: data.senderName,
        customerPhone: data.senderPhone,
        status: ConversationStatus.OPEN,
        handler: ConversationHandler.AI,
        messagesCount: 0,
        aiContext: {},
        metadata: {},
        tags: [],
      });
      
      await this.conversationRepo.save(conversation);
    }

    if (!conversation) {
      throw new Error('Failed to create or find conversation');
    }

    // 4️⃣ CREATE AND SAVE MESSAGE
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const message = this.messageRepo.create({
        tenantId: data.tenantId,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        type: data.type,
        status: MessageStatus.DELIVERED,
        sender: MessageSender.CUSTOMER,
        externalId: data.externalMessageId,
        content: data.content,
        media: data.media,
        location: data.location,
        metadata: data.metadata || {},
        deliveredAt: data.timestamp,
      });

      await queryRunner.manager.save(Message, message);

      const updateData: Record<string, unknown> = {
        messagesCount: () => '"messages_count" + 1',
        lastMessageAt: data.timestamp,
      };

      if (conversation.status === ConversationStatus.RESOLVED) {
        updateData.status = ConversationStatus.OPEN;
      }

      await queryRunner.manager.update(Conversation, conversation.id, updateData);

      await queryRunner.manager.update(Channel, channel.id, {
        lastMessageAt: data.timestamp,
      });

      await queryRunner.commitTransaction();

      // 5️⃣ EMIT EVENTS
      this.eventEmitter.emit('message.received', {
        message,
        conversation,
        channel,
        isNewConversation,
      });

      await this.messagingQueue.add('process-incoming', {
        messageId: message.id,
        conversationId: conversation.id,
        channelId: channel.id,
        tenantId: data.tenantId,
        isNewConversation,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Message saved in ${duration}ms: ${message.id}`);

      return message;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ Failed to save message: ${(error as Error).message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📤 CREATE OUTGOING MESSAGE
  // ═══════════════════════════════════════════════════════════════════════════

  async createOutgoingMessage(data: OutgoingMessageData): Promise<Message> {
    this.logger.log(`📤 Creating outgoing message for conversation: ${data.conversationId}`);

    const conversation = await this.conversationRepo.findOne({
      where: { id: data.conversationId },
      relations: ['channel'],
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${data.conversationId}`);
    }

    const message = this.messageRepo.create({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: data.type,
      status: MessageStatus.PENDING,
      sender: data.sender,
      content: data.content,
      media: data.media,
      metadata: {
        agentId: data.agentId,
        ...data.aiMetadata,
        interactive: data.interactive,
        template: data.template,
      },
    });

    const savedMessage = await this.messageRepo.save(message);

    await this.messagingQueue.add('send-message', {
      messageId: savedMessage.id,
      conversationId: conversation.id,
      channelId: conversation.channelId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });

    return savedMessage;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 QUERY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  async getConversationMessages(
    conversationId: string,
    options: {
      page?: number;
      limit?: number;
      before?: Date;
      after?: Date;
    } = {},
  ): Promise<{ messages: Message[]; total: number }> {
    const page = options.page || 1;
    const limit = Math.min(options.limit || 50, 100);
    const skip = (page - 1) * limit;

    const queryBuilder = this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', { conversationId });

    if (options.before) {
      queryBuilder.andWhere('message.createdAt < :before', { before: options.before });
    }
    if (options.after) {
      queryBuilder.andWhere('message.createdAt > :after', { after: options.after });
    }

    const total = await queryBuilder.getCount();

    const messages = await queryBuilder
      .orderBy('message.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return { messages: messages.reverse(), total };
  }

  async searchMessages(filters: MessageFilters): Promise<{
    messages: Message[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const skip = (page - 1) * limit;

    const queryBuilder = this.messageRepo
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.conversation', 'conversation')
      .where('message.tenantId = :tenantId', { tenantId: filters.tenantId });

    if (filters.conversationId) {
      queryBuilder.andWhere('message.conversationId = :conversationId', {
        conversationId: filters.conversationId,
      });
    }

    if (filters.direction) {
      queryBuilder.andWhere('message.direction = :direction', {
        direction: filters.direction,
      });
    }

    if (filters.type) {
      queryBuilder.andWhere('message.type = :type', { type: filters.type });
    }

    if (filters.status) {
      queryBuilder.andWhere('message.status = :status', { status: filters.status });
    }

    if (filters.sender) {
      queryBuilder.andWhere('message.sender = :sender', { sender: filters.sender });
    }

    if (filters.startDate) {
      queryBuilder.andWhere('message.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      queryBuilder.andWhere('message.createdAt <= :endDate', {
        endDate: filters.endDate,
      });
    }

    if (filters.search) {
      queryBuilder.andWhere('message.content ILIKE :search', {
        search: `%${filters.search}%`,
      });
    }

    const total = await queryBuilder.getCount();

    const messages = await queryBuilder
      .orderBy('message.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      messages,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getMessageById(messageId: string): Promise<Message | null> {
    return this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });
  }

  async getRecentMessages(
    conversationId: string,
    limit: number = 10,
  ): Promise<Message[]> {
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  async getMessageStats(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    total: number;
    inbound: number;
    outbound: number;
    byStatus: Record<string, number>;
    bySender: Record<string, number>;
    byType: Record<string, number>;
    avgResponseTime: number;
  }> {
    const directionStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.direction', 'direction')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.direction')
      .getRawMany();

    const statusStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.status')
      .getRawMany();

    const senderStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.sender', 'sender')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.sender')
      .getRawMany();

    const typeStats = await this.messageRepo
      .createQueryBuilder('message')
      .select('message.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('message.tenantId = :tenantId', { tenantId })
      .andWhere('message.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('message.type')
      .getRawMany();

    const avgResponseTime = await this.conversationRepo
      .createQueryBuilder('conversation')
      .select('AVG(EXTRACT(EPOCH FROM (conversation.firstResponseAt - conversation.createdAt)))', 'avg')
      .where('conversation.tenantId = :tenantId', { tenantId })
      .andWhere('conversation.firstResponseAt IS NOT NULL')
      .andWhere('conversation.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .getRawOne();

    const directionMap = directionStats.reduce((acc, item) => {
      acc[item.direction] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);

    return {
      total: (directionMap.inbound || 0) + (directionMap.outbound || 0),
      inbound: directionMap.inbound || 0,
      outbound: directionMap.outbound || 0,
      byStatus: statusStats.reduce((acc, item) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      bySender: senderStats.reduce((acc, item) => {
        acc[item.sender] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      byType: typeStats.reduce((acc, item) => {
        acc[item.type] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      avgResponseTime: parseFloat(avgResponseTime?.avg) || 0,
    };
  }
}
