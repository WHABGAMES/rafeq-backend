/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Replies Service                            ║
 * ║                                                                                ║
 * ║  ✅ v2: PostgreSQL persistence via TypeORM (was in-memory Map)                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuickReplyEntity } from './entities/quick-reply.entity';
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto';

// ─── Interfaces (kept for backward compat) ──────────────────────────────────

export interface QuickReply {
  id: string;
  tenantId: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string;
  variables?: string[];
  attachments?: Array<{ type: string; url: string; name?: string }>;
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

// ─── Default categories (static, no DB needed) ─────────────────────────────

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-greetings', tenantId: 'default', name: 'ترحيب', icon: '👋', count: 0 },
  { id: 'cat-orders', tenantId: 'default', name: 'طلبات', icon: '📦', count: 0 },
  { id: 'cat-shipping', tenantId: 'default', name: 'شحن', icon: '🚚', count: 0 },
  { id: 'cat-support', tenantId: 'default', name: 'دعم', icon: '🛟', count: 0 },
  { id: 'cat-closing', tenantId: 'default', name: 'إغلاق', icon: '✅', count: 0 },
  { id: 'cat-general', tenantId: 'default', name: 'عام', icon: '📝', count: 0 },
];

@Injectable()
export class QuickRepliesService {
  private readonly logger = new Logger(QuickRepliesService.name);

  constructor(
    @InjectRepository(QuickReplyEntity)
    private readonly repo: Repository<QuickReplyEntity>,
  ) {}

  // ─── Categories (static) ────────────────────────────────────────────────

  async getCategories(_tenantId: string): Promise<{ categories: Category[] }> {
    return { categories: DEFAULT_CATEGORIES };
  }

  async createCategory(_tenantId: string, data: { name: string; icon?: string }): Promise<Category> {
    return {
      id: `cat-${Date.now()}`,
      tenantId: _tenantId,
      name: data.name,
      icon: data.icon,
      count: 0,
    };
  }

  async deleteCategory(_id: string, _tenantId: string): Promise<void> {
    // Categories are static for now
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async findAll(tenantId: string, filters: Filters): Promise<{
    data: QuickReply[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('qr')
      .where('(qr.tenantId = :tenantId OR qr.isGlobal = true)', { tenantId })
      .andWhere('qr.deletedAt IS NULL');

    if (filters.category) {
      qb.andWhere('qr.category = :category', { category: filters.category });
    }

    if (filters.search) {
      qb.andWhere(
        '(qr.shortcut ILIKE :search OR qr.title ILIKE :search OR qr.content ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    qb.orderBy('qr.usageCount', 'DESC')
      .addOrderBy('qr.createdAt', 'DESC');

    const total = await qb.getCount();
    const data = await qb.skip(skip).take(limit).getMany();

    return {
      data: data.map(this.toInterface),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async search(tenantId: string, query: string): Promise<{ results: QuickReply[] }> {
    const results = await this.repo
      .createQueryBuilder('qr')
      .where('(qr.tenantId = :tenantId OR qr.isGlobal = true)', { tenantId })
      .andWhere('qr.deletedAt IS NULL')
      .andWhere(
        '(qr.shortcut ILIKE :q OR qr.title ILIKE :q)',
        { q: `%${query}%` },
      )
      .orderBy('qr.usageCount', 'DESC')
      .take(10)
      .getMany();

    return { results: results.map(this.toInterface) };
  }

  async create(tenantId: string, userId: string, dto: CreateQuickReplyDto): Promise<QuickReply> {
    const variableMatches = dto.content.match(/\{\{(\w+)\}\}/g);
    const variables = variableMatches
      ? variableMatches.map((v) => v.replace(/\{\{|\}\}/g, ''))
      : [];

    const entity = this.repo.create({
      tenantId,
      shortcut: dto.shortcut,
      title: dto.title || dto.shortcut,
      content: dto.content,
      category: dto.category,
      variables,
      attachments: dto.attachments || [],
      isGlobal: false,
      createdBy: userId,
      usageCount: 0,
    });

    const saved = await this.repo.save(entity);
    this.logger.log(`Quick reply created: ${saved.id}`, { tenantId, shortcut: dto.shortcut });

    return this.toInterface(saved);
  }

  async findById(id: string, tenantId: string): Promise<QuickReply> {
    const entity = await this.repo.findOne({
      where: [
        { id, tenantId },
        { id, isGlobal: true },
      ],
    });

    if (!entity) {
      throw new NotFoundException('الرد السريع غير موجود');
    }

    return this.toInterface(entity);
  }

  async update(id: string, tenantId: string, dto: UpdateQuickReplyDto): Promise<QuickReply> {
    const entity = await this.repo.findOne({ where: { id, tenantId } });

    if (!entity) {
      throw new NotFoundException('الرد السريع غير موجود');
    }

    if (entity.isGlobal) {
      throw new NotFoundException('لا يمكن تعديل الردود الافتراضية');
    }

    if (dto.content) {
      const variableMatches = dto.content.match(/\{\{(\w+)\}\}/g);
      entity.variables = variableMatches
        ? variableMatches.map((v) => v.replace(/\{\{|\}\}/g, ''))
        : [];
    }

    if (dto.shortcut !== undefined) entity.shortcut = dto.shortcut;
    if (dto.title !== undefined) entity.title = dto.title;
    if (dto.content !== undefined) entity.content = dto.content;
    if (dto.category !== undefined) entity.category = dto.category;
    if (dto.attachments !== undefined) entity.attachments = dto.attachments;

    const saved = await this.repo.save(entity);
    return this.toInterface(saved);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const entity = await this.repo.findOne({ where: { id, tenantId } });

    if (!entity) {
      throw new NotFoundException('الرد السريع غير موجود');
    }

    if (entity.isGlobal) {
      throw new NotFoundException('لا يمكن حذف الردود الافتراضية');
    }

    await this.repo.softRemove(entity);
    this.logger.log(`Quick reply deleted: ${id}`, { tenantId });
  }

  async recordUsage(id: string, tenantId: string, _userId: string): Promise<{ success: boolean; usageCount: number }> {
    await this.repo.increment({ id, tenantId }, 'usageCount', 1);
    const entity = await this.repo.findOne({ where: { id } });
    return { success: true, usageCount: entity?.usageCount || 0 };
  }

  async getPopular(tenantId: string, limit: number): Promise<{ replies: QuickReply[] }> {
    const entities = await this.repo.find({
      where: { tenantId },
      order: { usageCount: 'DESC' },
      take: limit,
    });

    return { replies: entities.map(this.toInterface) };
  }

  async findByShortcut(tenantId: string, shortcut: string): Promise<QuickReply | null> {
    const entity = await this.repo
      .createQueryBuilder('qr')
      .where('(qr.tenantId = :tenantId OR qr.isGlobal = true)', { tenantId })
      .andWhere('LOWER(qr.shortcut) = LOWER(:shortcut)', { shortcut })
      .andWhere('qr.deletedAt IS NULL')
      .getOne();

    return entity ? this.toInterface(entity) : null;
  }

  // ─── Helper ─────────────────────────────────────────────────────────────

  private toInterface(entity: QuickReplyEntity): QuickReply {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      shortcut: entity.shortcut,
      title: entity.title || entity.shortcut,
      content: entity.content,
      category: entity.category,
      variables: entity.variables || [],
      attachments: entity.attachments || [],
      isGlobal: entity.isGlobal,
      createdBy: entity.createdBy || '',
      usageCount: entity.usageCount,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
