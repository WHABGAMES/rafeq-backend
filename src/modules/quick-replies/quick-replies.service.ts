/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Replies Service                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto';

export interface QuickReply {
  id: string;
  tenantId: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string;
  variables?: string[];
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
  }>;
  isGlobal: boolean;
  createdBy: string;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  icon?: string;
  count: number;
}

export interface Filters {
  category?: string;
  search?: string;
  page: number;
  limit: number;
}

@Injectable()
export class QuickRepliesService {
  private readonly logger = new Logger(QuickRepliesService.name);

  private quickReplies: Map<string, QuickReply> = new Map();
  private categories: Map<string, Category> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults() {
    const defaultReplies = [
      {
        id: 'qr-1',
        shortcut: '/hello',
        title: 'تحية',
        content: 'مرحباً {{customer_name}}! 👋\nكيف يمكنني مساعدتك اليوم؟',
        category: 'greetings',
        variables: ['customer_name'],
      },
      {
        id: 'qr-2',
        shortcut: '/thanks',
        title: 'شكر',
        content: 'شكراً لتواصلك معنا {{customer_name}}! 🙏\nنتمنى لك يوماً سعيداً.',
        category: 'greetings',
        variables: ['customer_name'],
      },
    ];

    const defaultCategories = [
      { id: 'cat-1', name: 'تحيات', icon: '👋' },
      { id: 'cat-2', name: 'الطلبات', icon: '📦' },
    ];

    const tenantId = 'default';

    defaultReplies.forEach((reply) => {
      this.quickReplies.set(reply.id, {
        ...reply,
        tenantId,
        isGlobal: true,
        createdBy: 'system',
        usageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    defaultCategories.forEach((cat) => {
      this.categories.set(cat.id, {
        ...cat,
        tenantId,
        count: defaultReplies.filter((r) => r.category === cat.name.toLowerCase()).length,
      });
    });
  }

  async getCategories(tenantId: string): Promise<{ categories: Category[] }> {
    const categories = Array.from(this.categories.values())
      .filter((c) => c.tenantId === tenantId || c.tenantId === 'default');

    return { categories };
  }

  async createCategory(tenantId: string, data: { name: string; icon?: string }): Promise<Category> {
    const id = `cat-${Date.now()}`;

    const category: Category = {
      id,
      tenantId,
      name: data.name,
      icon: data.icon,
      count: 0,
    };

    this.categories.set(id, category);

    return category;
  }

  async deleteCategory(id: string, tenantId: string): Promise<void> {
    const category = this.categories.get(id);

    if (!category || category.tenantId !== tenantId) {
      throw new NotFoundException('الفئة غير موجودة');
    }

    this.categories.delete(id);
  }

  async findAll(tenantId: string, filters: Filters): Promise<{
    data: QuickReply[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page, limit } = filters;

    let replies = Array.from(this.quickReplies.values())
      .filter((r) => r.tenantId === tenantId || r.isGlobal);

    if (filters.category) {
      replies = replies.filter((r) => r.category === filters.category);
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      replies = replies.filter(
        (r) =>
          r.shortcut.toLowerCase().includes(searchLower) ||
          r.title.toLowerCase().includes(searchLower) ||
          r.content.toLowerCase().includes(searchLower),
      );
    }

    replies.sort((a, b) => b.usageCount - a.usageCount);

    const total = replies.length;
    const start = (page - 1) * limit;
    const data = replies.slice(start, start + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async search(tenantId: string, query: string): Promise<{ results: QuickReply[] }> {
    const queryLower = query.toLowerCase();

    const replies = Array.from(this.quickReplies.values())
      .filter((r) => r.tenantId === tenantId || r.isGlobal)
      .filter(
        (r) =>
          r.shortcut.toLowerCase().startsWith(queryLower) ||
          r.title.toLowerCase().includes(queryLower),
      )
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    return { results: replies };
  }

  async create(tenantId: string, userId: string, dto: CreateQuickReplyDto): Promise<QuickReply> {
    const id = `qr-${Date.now()}`;

    const variableMatches = dto.content.match(/{{(\w+)}}/g);
    const variables = variableMatches
      ? variableMatches.map((v) => v.replace(/{{|}}/g, ''))
      : [];

    const quickReply: QuickReply = {
      id,
      tenantId,
      shortcut: dto.shortcut,
      title: dto.title,
      content: dto.content,
      category: dto.category,
      variables,
      attachments: dto.attachments,
      isGlobal: false,
      createdBy: userId,
      usageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.quickReplies.set(id, quickReply);

    this.logger.log(`Quick reply created: ${id}`, { tenantId, shortcut: dto.shortcut });

    return quickReply;
  }

  async findById(id: string, tenantId: string): Promise<QuickReply> {
    const reply = this.quickReplies.get(id);

    if (!reply || (reply.tenantId !== tenantId && !reply.isGlobal)) {
      throw new NotFoundException('الرد السريع غير موجود');
    }

    return reply;
  }

  async update(id: string, tenantId: string, dto: UpdateQuickReplyDto): Promise<QuickReply> {
    const reply = await this.findById(id, tenantId);

    if (reply.isGlobal) {
      throw new NotFoundException('لا يمكن تعديل الردود الافتراضية');
    }

    if (dto.content) {
      const variableMatches = dto.content.match(/{{(\w+)}}/g);
      reply.variables = variableMatches
        ? variableMatches.map((v) => v.replace(/{{|}}/g, ''))
        : [];
    }

    Object.assign(reply, dto, { updatedAt: new Date() });
    this.quickReplies.set(id, reply);

    return reply;
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const reply = await this.findById(id, tenantId);

    if (reply.isGlobal) {
      throw new NotFoundException('لا يمكن حذف الردود الافتراضية');
    }

    this.quickReplies.delete(id);

    this.logger.log(`Quick reply deleted: ${id}`, { tenantId });
  }

  async recordUsage(id: string, tenantId: string, _userId: string): Promise<{ success: boolean; usageCount: number }> {
    const reply = await this.findById(id, tenantId);

    reply.usageCount += 1;
    this.quickReplies.set(id, reply);

    return { success: true, usageCount: reply.usageCount };
  }

  async getPopular(tenantId: string, limit: number): Promise<{ replies: QuickReply[] }> {
    const replies = Array.from(this.quickReplies.values())
      .filter((r) => r.tenantId === tenantId || r.isGlobal)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);

    return { replies };
  }

  async findByShortcut(tenantId: string, shortcut: string): Promise<QuickReply | null> {
    const reply = Array.from(this.quickReplies.values())
      .find(
        (r) =>
          (r.tenantId === tenantId || r.isGlobal) &&
          r.shortcut.toLowerCase() === shortcut.toLowerCase(),
      );

    return reply || null;
  }
}
