/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Tags Service                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateTagDto, UpdateTagDto } from './dto';

// ✅ تم تصدير الـ interface
export interface Tag {
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

export interface TagFilters {
  type?: string;
  search?: string;
}

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  // In-memory storage (replace with database)
  private tags: Map<string, Tag> = new Map();

  /**
   * جلب جميع التصنيفات
   */
  async findAll(tenantId: string, filters: TagFilters) {
    let tags = Array.from(this.tags.values())
      .filter((t) => t.tenantId === tenantId);

    if (filters.type && filters.type !== 'all') {
      tags = tags.filter((t) => t.type === filters.type || t.type === 'both');
    }

    if (filters.search) {
      const search = filters.search.toLowerCase();
      tags = tags.filter((t) =>
        t.name.toLowerCase().includes(search) ||
        t.description?.toLowerCase().includes(search)
      );
    }

    return {
      data: tags,
      total: tags.length,
    };
  }

  /**
   * إنشاء تصنيف
   */
  async create(tenantId: string, dto: CreateTagDto) {
    // Check for duplicate name
    const existing = Array.from(this.tags.values())
      .find((t) => t.tenantId === tenantId && t.name === dto.name);

    if (existing) {
      throw new BadRequestException('يوجد تصنيف بنفس الاسم');
    }

    const id = `tag-${Date.now()}`;

    const tag: Tag = {
      id,
      tenantId,
      name: dto.name,
      color: dto.color || '#6366f1',
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
   * جلب تصنيف بالـ ID
   */
  async findById(id: string, tenantId: string) {
    const tag = this.tags.get(id);

    if (!tag || tag.tenantId !== tenantId) {
      throw new NotFoundException('التصنيف غير موجود');
    }

    return tag;
  }

  /**
   * تحديث تصنيف
   */
  async update(id: string, tenantId: string, dto: UpdateTagDto) {
    const tag = await this.findById(id, tenantId);

    // Check for duplicate name if changing
    if (dto.name && dto.name !== tag.name) {
      const existing = Array.from(this.tags.values())
        .find((t) => t.tenantId === tenantId && t.name === dto.name && t.id !== id);

      if (existing) {
        throw new BadRequestException('يوجد تصنيف بنفس الاسم');
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
    await this.findById(id, tenantId);
    this.tags.delete(id);
    this.logger.log(`Tag deleted: ${id}`, { tenantId });
  }

  /**
   * إحصائيات الاستخدام
   */
  async getStats(tenantId: string) {
    const tags = Array.from(this.tags.values())
      .filter((t) => t.tenantId === tenantId);

    return {
      totalTags: tags.length,
      byType: {
        conversation: tags.filter((t) => t.type === 'conversation').length,
        contact: tags.filter((t) => t.type === 'contact').length,
        both: tags.filter((t) => t.type === 'both').length,
      },
      mostUsed: tags
        .sort((a, b) => (b.conversationCount + b.contactCount) - (a.conversationCount + a.contactCount))
        .slice(0, 10),
    };
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
        results.push({ success: false, name: dto.name, error: (error as Error).message });
      }
    }

    return {
      total: dtos.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
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
        results.push({ id, success: false, error: (error as Error).message });
      }
    }

    return {
      total: ids.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * دمج تصنيفين
   */
  async mergeTags(targetId: string, sourceId: string, tenantId: string) {
    const targetTag = await this.findById(targetId, tenantId);
    const sourceTag = await this.findById(sourceId, tenantId);

    // Transfer counts
    targetTag.conversationCount += sourceTag.conversationCount;
    targetTag.contactCount += sourceTag.contactCount;
    targetTag.updatedAt = new Date();

    this.tags.set(targetId, targetTag);

    // Delete source tag
    this.tags.delete(sourceId);

    this.logger.log(`Tags merged: ${sourceId} → ${targetId}`, { tenantId });

    return {
      success: true,
      message: `تم دمج "${sourceTag.name}" في "${targetTag.name}"`,
      tag: targetTag,
    };
  }

  /**
   * إضافة تصنيف لمحادثة (زيادة العداد)
   */
  async incrementConversationCount(tagId: string, tenantId: string) {
    const tag = await this.findById(tagId, tenantId);
    tag.conversationCount += 1;
    tag.updatedAt = new Date();
    this.tags.set(tagId, tag);
  }

  /**
   * إزالة تصنيف من محادثة (تقليل العداد)
   */
  async decrementConversationCount(tagId: string, tenantId: string) {
    const tag = await this.findById(tagId, tenantId);
    if (tag.conversationCount > 0) {
      tag.conversationCount -= 1;
      tag.updatedAt = new Date();
      this.tags.set(tagId, tag);
    }
  }

  /**
   * إضافة تصنيف لجهة اتصال (زيادة العداد)
   */
  async incrementContactCount(tagId: string, tenantId: string) {
    const tag = await this.findById(tagId, tenantId);
    tag.contactCount += 1;
    tag.updatedAt = new Date();
    this.tags.set(tagId, tag);
  }

  /**
   * إزالة تصنيف من جهة اتصال (تقليل العداد)
   */
  async decrementContactCount(tagId: string, tenantId: string) {
    const tag = await this.findById(tagId, tenantId);
    if (tag.contactCount > 0) {
      tag.contactCount -= 1;
      tag.updatedAt = new Date();
      this.tags.set(tagId, tag);
    }
  }

  /**
   * البحث عن تصنيفات بالأسماء
   */
  async findByNames(tenantId: string, names: string[]): Promise<Tag[]> {
    return Array.from(this.tags.values())
      .filter((t) => t.tenantId === tenantId && names.includes(t.name));
  }

  /**
   * الحصول على التصنيفات الأكثر استخداماً
   */
  async getPopularTags(tenantId: string, limit = 10): Promise<Tag[]> {
    return Array.from(this.tags.values())
      .filter((t) => t.tenantId === tenantId)
      .sort((a, b) => (b.conversationCount + b.contactCount) - (a.conversationCount + a.contactCount))
      .slice(0, limit);
  }
}
