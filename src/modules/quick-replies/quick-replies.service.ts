/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Replies Service                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto';

interface QuickReply {
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

interface Category {
  id: string;
  tenantId: string;
  name: string;
  icon?: string;
  count: number;
}

interface Filters {
  category?: string;
  search?: string;
  page: number;
  limit: number;
}

@Injectable()
export class QuickRepliesService {
  private readonly logger = new Logger(QuickRepliesService.name);

  // In-memory storage (replace with database)
  private quickReplies: Map<string, QuickReply> = new Map();
  private categories: Map<string, Category> = new Map();

  constructor() {
    // Add default quick replies
    this.initializeDefaults();
  }

  /**
   * Initialize default quick replies
   */
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
      {
        id: 'qr-3',
        shortcut: '/order',
        title: 'حالة الطلب',
        content: 'يمكنك تتبع طلبك من هنا:\n{{order_tracking_url}}\n\nإذا كان لديك أي استفسار، أنا هنا للمساعدة!',
        category: 'orders',
        variables: ['order_tracking_url'],
      },
      {
        id: 'qr-4',
        shortcut: '/return',
        title: 'سياسة الاسترجاع',
        content: 'سياسة الاسترجاع:\n- يمكنك استرجاع المنتج خلال 14 يوم من الاستلام\n- المنتج يجب أن يكون بحالته الأصلية\n- سيتم رد المبلغ خلال 5-7 أيام عمل\n\nهل تريد بدء طلب استرجاع؟',
        category: 'policies',
      },
      {
        id: 'qr-5',
        shortcut: '/shipping',
        title: 'معلومات الشحن',
        content: 'معلومات الشحن:\n📦 الشحن داخل المدينة: 1-2 يوم عمل\n🚚 الشحن لباقي المناطق: 3-5 أيام عمل\n💰 الشحن مجاني للطلبات فوق 200 ريال',
        category: 'shipping',
      },
      {
        id: 'qr-6',
        shortcut: '/payment',
        title: 'طرق الدفع',
        content: 'طرق الدفع المتاحة:\n💳 بطاقة ائتمان (فيزا، ماستركارد)\n🏦 تحويل بنكي\n💵 الدفع عند الاستلام\n📱 Apple Pay / مدى',
        category: 'payment',
      },
      {
        id: 'qr-7',
        shortcut: '/wait',
        title: 'انتظار',
        content: 'لحظة من فضلك، أقوم بالتحقق من المعلومات... ⏳',
        category: 'general',
      },
      {
        id: 'qr-8',
        shortcut: '/transfer',
        title: 'تحويل',
        content: 'سأقوم بتحويلك إلى أحد المختصين للمساعدة بشكل أفضل. لحظات من فضلك... 🔄',
        category: 'general',
      },
    ];

    const defaultCategories = [
      { id: 'cat-1', name: 'تحيات', icon: '👋' },
      { id: 'cat-2', name: 'الطلبات', icon: '📦' },
      { id: 'cat-3', name: 'السياسات', icon: '📋' },
      { id: 'cat-4', name: 'الشحن', icon: '🚚' },
      { id: 'cat-5', name: 'الدفع', icon: '💳' },
      { id: 'cat-6', name: 'عام', icon: '💬' },
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

  /**
   * جلب الفئات
   */
  async getCategories(tenantId: string) {
    const categories = Array.from(this.categories.values())
      .filter((c) => c.tenantId === tenantId || c.tenantId === 'default');

    return { categories };
  }

  /**
   * إنشاء فئة
   */
  async createCategory(tenantId: string, data: { name: string; icon?: string }) {
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

  /**
   * حذف فئة
   */
  async deleteCategory(id: string, tenantId: string) {
    const category = this.categories.get(id);

    if (!category || category.tenantId !== tenantId) {
      throw new NotFoundException('الفئة غير موجودة');
    }

    this.categories.delete(id);
  }

  /**
   * جلب جميع الردود
   */
  async findAll(tenantId: string, filters: Filters) {
    const { page, limit } = filters;

    let replies = Array.from(this.quickReplies.values())
      .filter((r) => r.tenantId === tenantId || r.isGlobal);

    // Filter by category
    if (filters.category) {
      replies = replies.filter((r) => r.category === filters.category);
    }

    // Search
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      replies = replies.filter(
        (r) =>
          r.shortcut.toLowerCase().includes(searchLower) ||
          r.title.toLowerCase().includes(searchLower) ||
          r.content.toLowerCase().includes(searchLower),
      );
    }

    // Sort by usage count (most used first)
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

  /**
   * بحث سريع
   */
  async search(tenantId: string, query: string) {
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

  /**
   * إنشاء رد سريع
   */
  async create(tenantId: string, userId: string, dto: CreateQuickReplyDto) {
    const id = `qr-${Date.now()}`;

    // Extract variables from content
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

  /**
   * جلب رد بالـ ID
   */
  async findById(id: string, tenantId: string) {
    const reply = this.quickReplies.get(id);

    if (!reply || (reply.tenantId !== tenantId && !reply.isGlobal)) {
      throw new NotFoundException('الرد السريع غير موجود');
    }

    return reply;
  }

  /**
   * تحديث رد سريع
   */
  async update(id: string, tenantId: string, dto: UpdateQuickReplyDto) {
    const reply = await this.findById(id, tenantId);

    if (reply.isGlobal) {
      throw new NotFoundException('لا يمكن تعديل الردود الافتراضية');
    }

    // Extract variables if content changed
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

  /**
   * حذف رد سريع
   */
  async delete(id: string, tenantId: string) {
    const reply = await this.findById(id, tenantId);

    if (reply.isGlobal) {
      throw new NotFoundException('لا يمكن حذف الردود الافتراضية');
    }

    this.quickReplies.delete(id);

    this.logger.log(`Quick reply deleted: ${id}`, { tenantId });
  }

  /**
   * تسجيل استخدام
   */
  async recordUsage(id: string, tenantId: string, userId: string) {
    const reply = await this.findById(id, tenantId);

    reply.usageCount += 1;
    this.quickReplies.set(id, reply);

    return { success: true, usageCount: reply.usageCount };
  }

  /**
   * الردود الأكثر استخداماً
   */
  async getPopular(tenantId: string, limit: number) {
    const replies = Array.from(this.quickReplies.values())
      .filter((r) => r.tenantId === tenantId || r.isGlobal)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);

    return { replies };
  }

  /**
   * جلب رد بالاختصار
   */
  async findByShortcut(tenantId: string, shortcut: string) {
    const reply = Array.from(this.quickReplies.values())
      .find(
        (r) =>
          (r.tenantId === tenantId || r.isGlobal) &&
          r.shortcut.toLowerCase() === shortcut.toLowerCase(),
      );

    return reply || null;
  }
}
