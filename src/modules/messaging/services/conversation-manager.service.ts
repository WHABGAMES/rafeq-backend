/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                RAFIQ PLATFORM - Conversation Manager Service                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, LessThan } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Entities
import {
  Conversation,
  ConversationStatus,
  ConversationPriority,
  ConversationHandler,
} from '../../../database/entities/conversation.entity';
import { ChannelType } from '../../../database/entities/channel.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 INTERFACES & TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export const ALLOWED_STATUS_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  [ConversationStatus.OPEN]: [
    ConversationStatus.PENDING,
    ConversationStatus.ASSIGNED,
    ConversationStatus.RESOLVED,
    ConversationStatus.CLOSED,
  ],
  [ConversationStatus.PENDING]: [
    ConversationStatus.OPEN,
    ConversationStatus.ASSIGNED,
    ConversationStatus.RESOLVED,
    ConversationStatus.CLOSED,
  ],
  [ConversationStatus.ASSIGNED]: [
    ConversationStatus.OPEN,
    ConversationStatus.PENDING,
    ConversationStatus.RESOLVED,
    ConversationStatus.CLOSED,
  ],
  [ConversationStatus.RESOLVED]: [
    ConversationStatus.OPEN,
    ConversationStatus.CLOSED,
  ],
  [ConversationStatus.CLOSED]: [
    ConversationStatus.OPEN,
  ],
};

export interface ConversationFilters {
  tenantId: string;
  status?: ConversationStatus | ConversationStatus[];
  handler?: ConversationHandler;
  channelId?: string;
  channelType?: ChannelType;
  assignedToId?: string;
  unassigned?: boolean;
  priority?: ConversationPriority;
  tags?: string[];
  search?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
  orderBy?: 'lastMessageAt' | 'createdAt' | 'priority' | 'messagesCount';
  orderDir?: 'ASC' | 'DESC';
}

export interface AssignmentData {
  conversationId: string;
  assignedToId: string;
  assignedById?: string;
  note?: string;
}

export interface HandoffRequest {
  conversationId: string;
  reason: string;
  priority?: ConversationPriority;
  context?: Record<string, unknown>;
}

export interface AIContext {
  intent?: string;
  subIntent?: string;
  verified?: boolean;
  orderId?: string;
  productId?: string;
  failedAttempts?: number;
  lastToolsCalled?: string[];
  conversationSummary?: string;
  customerMood?: 'positive' | 'neutral' | 'negative' | 'frustrated';
  handoffReason?: string;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📌 CONVERSATION MANAGER SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class ConversationManagerService {
  private readonly logger = new Logger(ConversationManagerService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔄 STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async changeStatus(
    conversationId: string,
    newStatus: ConversationStatus,
    options: {
      userId?: string;
      reason?: string;
      force?: boolean;
    } = {},
  ): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${conversationId}`);
    }

    const currentStatus = conversation.status;

    if (!options.force) {
      const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[currentStatus];
      if (!allowedTransitions.includes(newStatus)) {
        throw new BadRequestException(
          `Cannot transition from ${currentStatus} to ${newStatus}. ` +
          `Allowed transitions: ${allowedTransitions.join(', ')}`,
        );
      }
    }

    conversation.status = newStatus;

    if (newStatus === ConversationStatus.RESOLVED) {
      conversation.resolvedAt = new Date();
    }

    const updatedConversation = await this.conversationRepo.save(conversation);

    this.eventEmitter.emit('conversation.status.changed', {
      conversation: updatedConversation,
      previousStatus: currentStatus,
      newStatus,
      userId: options.userId,
    });

    return updatedConversation;
  }

  async getById(conversationId: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['channel', 'assignedTo'],
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${conversationId}`);
    }

    return conversation;
  }

  async getUnassignedConversations(
    tenantId: string,
    channelId?: string,
  ): Promise<Conversation[]> {
    const whereCondition: Record<string, unknown> = {
      tenantId,
      status: ConversationStatus.PENDING,
      handler: In([ConversationHandler.HUMAN, ConversationHandler.UNASSIGNED]),
      assignedToId: IsNull(),
    };

    if (channelId) {
      whereCondition.channelId = channelId;
    }

    return this.conversationRepo.find({
      where: whereCondition,
      relations: ['channel'],
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
  }

  async addTag(conversationId: string, tag: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${conversationId}`);
    }

    const tags = [...new Set([...(conversation.tags || []), tag])];
    conversation.tags = tags;
    
    return this.conversationRepo.save(conversation);
  }

  async removeTag(conversationId: string, tag: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${conversationId}`);
    }

    const tags = (conversation.tags || []).filter((t) => t !== tag);
    conversation.tags = tags;

    return this.conversationRepo.save(conversation);
  }

  async updatePriority(
    conversationId: string,
    priority: ConversationPriority,
  ): Promise<Conversation> {
    const conversation = await this.getById(conversationId);
    conversation.priority = priority;
    return this.conversationRepo.save(conversation);
  }

  async addNote(conversationId: string, note: string, userId?: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation not found: ${conversationId}`);
    }

    const timestamp = new Date().toISOString();
    const formattedNote = `[${timestamp}${userId ? ` - ${userId}` : ''}] ${note}`;
    const updatedNotes = conversation.notes
      ? `${conversation.notes}\n${formattedNote}`
      : formattedNote;

    conversation.notes = updatedNotes;

    return this.conversationRepo.save(conversation);
  }

  async getStats(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byHandler: Record<string, number>;
    byPriority: Record<string, number>;
    avgResolutionTime: number;
    avgFirstResponseTime: number;
  }> {
    const queryBuilder = this.conversationRepo
      .createQueryBuilder('conversation')
      .where('conversation.tenantId = :tenantId', { tenantId });

    if (startDate) {
      queryBuilder.andWhere('conversation.createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      queryBuilder.andWhere('conversation.createdAt <= :endDate', { endDate });
    }

    const statusStats = await queryBuilder
      .clone()
      .select('conversation.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('conversation.status')
      .getRawMany();

    const handlerStats = await queryBuilder
      .clone()
      .select('conversation.handler', 'handler')
      .addSelect('COUNT(*)', 'count')
      .groupBy('conversation.handler')
      .getRawMany();

    const priorityStats = await queryBuilder
      .clone()
      .select('conversation.priority', 'priority')
      .addSelect('COUNT(*)', 'count')
      .groupBy('conversation.priority')
      .getRawMany();

    const avgResolutionTime = await queryBuilder
      .clone()
      .select('AVG(EXTRACT(EPOCH FROM (conversation.resolvedAt - conversation.createdAt)))', 'avg')
      .andWhere('conversation.resolvedAt IS NOT NULL')
      .getRawOne();

    const avgFirstResponseTime = await queryBuilder
      .clone()
      .select('AVG(EXTRACT(EPOCH FROM (conversation.firstResponseAt - conversation.createdAt)))', 'avg')
      .andWhere('conversation.firstResponseAt IS NOT NULL')
      .getRawOne();

    const total = await queryBuilder.getCount();

    return {
      total,
      byStatus: statusStats.reduce((acc, item) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      byHandler: handlerStats.reduce((acc, item) => {
        acc[item.handler] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      byPriority: priorityStats.reduce((acc, item) => {
        acc[item.priority] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      avgResolutionTime: parseFloat(avgResolutionTime?.avg) || 0,
      avgFirstResponseTime: parseFloat(avgFirstResponseTime?.avg) || 0,
    };
  }

  async autoCloseStaleConversations(
    tenantId: string,
    options: {
      resolvedAfterHours?: number;
      inactiveAfterDays?: number;
    } = {},
  ): Promise<number> {
    const resolvedAfterHours = options.resolvedAfterHours || 24;
    const inactiveAfterDays = options.inactiveAfterDays || 7;

    const resolvedCutoff = new Date();
    resolvedCutoff.setHours(resolvedCutoff.getHours() - resolvedAfterHours);

    const inactiveCutoff = new Date();
    inactiveCutoff.setDate(inactiveCutoff.getDate() - inactiveAfterDays);

    const resolvedResult = await this.conversationRepo.update(
      {
        tenantId,
        status: ConversationStatus.RESOLVED,
        resolvedAt: LessThan(resolvedCutoff),
      },
      { status: ConversationStatus.CLOSED },
    );

    const inactiveResult = await this.conversationRepo.update(
      {
        tenantId,
        status: In([ConversationStatus.OPEN, ConversationStatus.PENDING]),
        lastMessageAt: LessThan(inactiveCutoff),
      },
      { status: ConversationStatus.CLOSED },
    );

    const totalClosed = (resolvedResult.affected || 0) + (inactiveResult.affected || 0);

    if (totalClosed > 0) {
      this.logger.log(`🧹 Auto-closed ${totalClosed} stale conversations for tenant: ${tenantId}`);
    }

    return totalClosed;
  }
}
