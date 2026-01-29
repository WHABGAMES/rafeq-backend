/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tags Service                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateTagDto, UpdateTagDto } from './dto';

interface Tag {
  id: string;
  tenantId: string;
  name: string;
  color: string;
  description?: string;
  type: 'conversation' | 'contact' | 'both';
  conversationCount: number;
  contactCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface TagFilters {
  type?: string;
  search?: string;
}

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  // In-memory storage (replace with database)
  private tags: Map<string, Tag> = new Map();

  constructor() {
    // Add default tags
    this.initializeDefaults();
  }

  /**
   * Initialize default tags
   */
  private initializeDefaults() {
    const defaultTags = [
      { id: 'tag-1', name: 'VIP', color: '#FFD700', type: 'both' as const },
      { id: 'tag-2', name: 'جديد', color: '#4CAF50', type: 'contact' as const },
      { id: 'tag-3', name: 'عاجل', color: '#F44336', type: 'conversation' as const },
      { id: 'tag-4', name: 'استفسار', color: '#2196F3', type: 'conversation' as const },
      { id: 'tag-5', name: 'شكوى', color: '#FF9800', type: 'conversation' as const },
      { id: 'tag-6', name: 'طلب', color: '#9C27B0', type: 'conversation' as const },
      { id: 'tag-7', name: 'متابعة', color: '#00BCD4', type: 'conversation' as const },
      { id: 'tag-8', name: 'مكتمل', color: '#8BC34A', type: 'conversation' as const },
    ];

    const tenantId = 'default';

    defaultTags.forEach((tag) => {
      this.tags.set(tag.id, {
        ...tag,
        tenantId,
        conversationCount: 0,
        contactCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }

  /**
   * جلب جميع التصنيفات
   */
  async findAll(tenantId: string, filters: TagFilters) {
    let tags = Array.from(this.tags.values())
      .filter((t) => t.tenantId === tenantId || t.tenantId === 'default');

    // Filter by type
    if (filters.type && filters.type !== 'all') {
      tags = tags.filter((t) => t.type === filters.type || t.type === 'both');
    }

    // Search
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      tags = tags.filter(
        (t) =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower),
      );
    }

    // Sort by name
    tags.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    return { tags, total: tags.length };
  }

  /**
   * إنشاء تصنيف
   */
  async create(tenantId: string, dto: CreateTagDto) {
    // Check for duplicate name
    const existing = Array.from(this.tags.values())
      .find(
        (t) =>
          t.tenantId === tenantId &&
          t.name.toLowerCase() === dto.name.toLowerCase(),
      );

    if (existing) {
      throw new BadRequestException('التصنيف موجود مسبقاً');
    }

    const id = `tag-${Date.now()}`;

    const tag: Tag = {
      id,
      tenantId,
      name: dto.name,
      color: dto.color || this.generateColor(),
      description: dto.description,
      type: dto.type || 'both',
      conversationCount: 0,
      contactCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tags.set(id, tag);

    this.logger.log(`Tag created: ${id}`, { tenantId, name: dto.name });

    return tag;
  }

  /**
   * إنشاء تصنيفات متعددة
   */
  async createBulk(tenantId: string, dtos: CreateTagDto[]) {
    const results = [];

    for (const dto of dtos) {
      try {
        const tag = await this.create(tenantId, dto);
        results.push({ success: true, tag });
      } catch (error) {
        results.push({ success: false, name: dto.name, error: error.message });
      }
    }

    return {
      total: dtos.length,
      created: results.filter((r) => r.success).length,
      results,
    };
  }

  /**
   * جلب تصنيف بالـ ID
   */
  async findById(id: string, tenantId: string) {
    const tag = this.tags.get(id);

    if (!tag || (tag.tenantId !== tenantId && tag.tenantId !== 'default')) {
      throw new NotFoundException('التصنيف غير موجود');
    }

    return tag;
  }

  /**
   * جلب تصنيف بالاسم
   */
  async findByName(tenantId: string, name: string) {
    return Array.from(this.tags.values())
      .find(
        (t) =>
          (t.tenantId === tenantId || t.tenantId === 'default') &&
          t.name.toLowerCase() === name.toLowerCase(),
      );
  }

  /**
   * تحديث تصنيف
   */
  async update(id: string, tenantId: string, dto: UpdateTagDto) {
    const tag = await this.findById(id, tenantId);

    if (tag.tenantId === 'default') {
      throw new BadRequestException('لا يمكن تعديل التصنيفات الافتراضية');
    }

    // Check for duplicate name if name is being changed
    if (dto.name && dto.name !== tag.name) {
      const existing = await this.findByName(tenantId, dto.name);
      if (existing) {
        throw new BadRequestException('التصنيف موجود مسبقاً');
      }
    }

    Object.assign(tag, dto, { updatedAt: new Date() });
    this.tags.set(id, tag);

    return tag;
  }

  /**
   * حذف تصنيف
   */
  async delete(id: string, tenantId: string) {
    const tag = await this.findById(id, tenantId);

    if (tag.tenantId === 'default') {
      throw new BadRequestException('لا يمكن حذف التصنيفات الافتراضية');
    }

    this.tags.delete(id);

    this.logger.log(`Tag deleted: ${id}`, { tenantId });
  }

  /**
   * حذف تصنيفات متعددة
   */
  async deleteBulk(tenantId: string, ids: string[]) {
    const results = [];

    for (const id of ids) {
      try {
        await this.delete(id, tenantId);
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }

    return {
      total: ids.length,
      deleted: results.filter((r) => r.success).length,
      results,
    };
  }

  /**
   * دمج تصنيفات
   */
  async mergeTags(targetId: string, sourceId: string, tenantId: string) {
    const target = await this.findById(targetId, tenantId);
    const source = await this.findById(sourceId, tenantId);

    if (source.tenantId === 'default') {
      throw new BadRequestException('لا يمكن دمج التصنيفات الافتراضية');
    }

    // Transfer counts
    target.conversationCount += source.conversationCount;
    target.contactCount += source.contactCount;
    target.updatedAt = new Date();

    // Delete source
    this.tags.delete(sourceId);

    this.tags.set(targetId, target);

    this.logger.log(`Tags merged: ${sourceId} -> ${targetId}`, { tenantId });

    return target;
  }

  /**
   * إحصائيات الاستخدام
   */
  async getStats(tenantId: string) {
    const tags = Array.from(this.tags.values())
      .filter((t) => t.tenantId === tenantId || t.tenantId === 'default');

    const totalTags = tags.length;
    const totalConversations = tags.reduce((sum, t) => sum + t.conversationCount, 0);
    const totalContacts = tags.reduce((sum, t) => sum + t.contactCount, 0);

    // Top tags by usage
    const topByConversations = [...tags]
      .sort((a, b) => b.conversationCount - a.conversationCount)
      .slice(0, 10);

    const topByContacts = [...tags]
      .sort((a, b) => b.contactCount - a.contactCount)
      .slice(0, 10);

    return {
      summary: {
        totalTags,
        totalConversations,
        totalContacts,
      },
      topByConversations,
      topByContacts,
    };
  }

  /**
   * تحديث عداد المحادثات
   */
  async incrementConversationCount(tagId: string) {
    const tag = this.tags.get(tagId);
    if (tag) {
      tag.conversationCount += 1;
      this.tags.set(tagId, tag);
    }
  }

  /**
   * تحديث عداد العملاء
   */
  async incrementContactCount(tagId: string) {
    const tag = this.tags.get(tagId);
    if (tag) {
      tag.contactCount += 1;
      this.tags.set(tagId, tag);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateColor(): string {
    const colors = [
      '#F44336', '#E91E63', '#9C27B0', '#673AB7',
      '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
      '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
      '#FFEB3B', '#FFC107', '#FF9800', '#FF5722',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
