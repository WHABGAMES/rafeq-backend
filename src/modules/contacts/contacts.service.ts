/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Contacts Service (CRM)                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, Conversation, Order } from '@database/entities';
import {
  CreateContactDto,
  UpdateContactDto,
  ContactFiltersDto,
  ImportContactsDto,
  CreateSegmentDto,
} from './dto';

interface PaginationOptions {
  page: number;
  limit: number;
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  /**
   * جلب جميع العملاء مع الفلترة
   */
  async findAll(
    tenantId: string,
    filters: ContactFiltersDto,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const queryBuilder = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenantId = :tenantId', { tenantId });

    // Search filter
    if (filters.search) {
      queryBuilder.andWhere(
        '(customer.name ILIKE :search OR customer.phone ILIKE :search OR customer.email ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    // Tags filter
    if (filters.tags?.length) {
      queryBuilder.andWhere('customer.tags && :tags', { tags: filters.tags });
    }

    // Channel filter
    if (filters.channel) {
      queryBuilder.andWhere('customer.channel = :channel', { channel: filters.channel });
    }

    // Sorting
    const sortColumn = `customer.${filters.sortBy || 'createdAt'}`;
    queryBuilder.orderBy(sortColumn, filters.sortOrder?.toUpperCase() as 'ASC' | 'DESC' || 'DESC');

    // Get total count
    const total = await queryBuilder.getCount();

    // Get paginated results
    const contacts = await queryBuilder
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      data: contacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * إحصائيات العملاء
   */
  async getStats(tenantId: string) {
    const total = await this.customerRepository.count({ where: { tenantId } });
    
    // Get counts by different criteria
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const newToday = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenantId = :tenantId', { tenantId })
      .andWhere('customer.createdAt >= :today', { today })
      .getCount();

    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const newThisMonth = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenantId = :tenantId', { tenantId })
      .andWhere('customer.createdAt >= :thisMonth', { thisMonth })
      .getCount();

    return {
      total,
      newToday,
      newThisMonth,
      withOrders: 0, // TODO: Calculate from orders
      blocked: 0, // TODO: Add blocked field
      byChannel: {
        whatsapp: 0,
        instagram: 0,
        telegram: 0,
        email: 0,
        sms: 0,
      },
    };
  }

  /**
   * إنشاء عميل جديد
   */
  async create(tenantId: string, dto: CreateContactDto) {
    // Check for duplicate phone/email
    const existing = await this.customerRepository.findOne({
      where: [
        { tenantId, phone: dto.phone },
        dto.email ? { tenantId, email: dto.email } : undefined,
      ].filter(Boolean),
    });

    if (existing) {
      throw new BadRequestException('العميل موجود مسبقاً');
    }

    const contact = this.customerRepository.create({
      ...dto,
      tenantId,
    });

    const saved = await this.customerRepository.save(contact);

    this.logger.log(`Contact created: ${saved.id}`, { tenantId, phone: dto.phone });

    return saved;
  }

  /**
   * جلب عميل بالـ ID
   */
  async findById(id: string, tenantId: string) {
    const contact = await this.customerRepository.findOne({
      where: { id, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }

    // Get additional stats
    const conversationCount = await this.conversationRepository.count({
      where: { customerId: id, tenantId },
    });

    const orderCount = await this.orderRepository.count({
      where: { customerId: id, tenantId },
    });

    return {
      ...contact,
      stats: {
        conversationCount,
        orderCount,
        totalSpent: 0, // TODO: Calculate from orders
        lastOrderDate: null,
        averageOrderValue: 0,
      },
    };
  }

  /**
   * تحديث عميل
   */
  async update(id: string, tenantId: string, dto: UpdateContactDto) {
    const contact = await this.findById(id, tenantId);

    Object.assign(contact, dto);

    return this.customerRepository.save(contact);
  }

  /**
   * حذف عميل
   */
  async delete(id: string, tenantId: string) {
    const contact = await this.findById(id, tenantId);
    await this.customerRepository.remove(contact);
    this.logger.log(`Contact deleted: ${id}`, { tenantId });
  }

  /**
   * جلب محادثات العميل
   */
  async getConversations(
    contactId: string,
    tenantId: string,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [conversations, total] = await this.conversationRepository.findAndCount({
      where: { customerId: contactId, tenantId },
      order: { updatedAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: conversations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * جلب طلبات العميل
   */
  async getOrders(
    contactId: string,
    tenantId: string,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [orders, total] = await this.orderRepository.findAndCount({
      where: { customerId: contactId, tenantId },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * سجل النشاطات
   */
  async getTimeline(
    contactId: string,
    tenantId: string,
    pagination: PaginationOptions,
  ) {
    // Combine conversations, orders, and notes into timeline
    // TODO: Implement proper timeline aggregation
    return {
      data: [],
      pagination: {
        ...pagination,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * إضافة تصنيفات
   */
  async addTags(contactId: string, tenantId: string, tags: string[]) {
    const contact = await this.findById(contactId, tenantId);
    
    const existingTags = contact.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];
    
    contact.tags = newTags;
    
    return this.customerRepository.save(contact);
  }

  /**
   * إزالة تصنيف
   */
  async removeTag(contactId: string, tenantId: string, tag: string) {
    const contact = await this.findById(contactId, tenantId);
    
    contact.tags = (contact.tags || []).filter((t) => t !== tag);
    
    await this.customerRepository.save(contact);
  }

  /**
   * جلب الملاحظات
   */
  async getNotes(contactId: string, tenantId: string) {
    // TODO: Implement notes storage
    return { notes: [] };
  }

  /**
   * إضافة ملاحظة
   */
  async addNote(contactId: string, tenantId: string, userId: string, content: string) {
    // TODO: Implement notes storage
    return {
      id: 'note-id',
      contactId,
      userId,
      content,
      createdAt: new Date(),
    };
  }

  /**
   * حذف ملاحظة
   */
  async deleteNote(contactId: string, tenantId: string, noteId: string) {
    // TODO: Implement notes deletion
  }

  /**
   * دمج عملاء
   */
  async mergeContacts(primaryId: string, secondaryId: string, tenantId: string) {
    const primary = await this.findById(primaryId, tenantId);
    const secondary = await this.findById(secondaryId, tenantId);

    // Merge tags
    primary.tags = [...new Set([...(primary.tags || []), ...(secondary.tags || [])])];

    // Update conversations to point to primary
    await this.conversationRepository.update(
      { customerId: secondaryId, tenantId },
      { customerId: primaryId },
    );

    // Update orders to point to primary
    await this.orderRepository.update(
      { customerId: secondaryId, tenantId },
      { customerId: primaryId },
    );

    // Delete secondary contact
    await this.customerRepository.remove(secondary);

    // Save primary with merged data
    return this.customerRepository.save(primary);
  }

  /**
   * حظر عميل
   */
  async blockContact(contactId: string, tenantId: string, reason?: string) {
    const contact = await this.findById(contactId, tenantId);
    
    contact.isBlocked = true;
    contact.blockReason = reason;
    contact.blockedAt = new Date();
    
    return this.customerRepository.save(contact);
  }

  /**
   * إلغاء حظر عميل
   */
  async unblockContact(contactId: string, tenantId: string) {
    const contact = await this.findById(contactId, tenantId);
    
    contact.isBlocked = false;
    contact.blockReason = null;
    contact.blockedAt = null;
    
    return this.customerRepository.save(contact);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Segments
  // ═══════════════════════════════════════════════════════════════════════════════

  async getSegments(tenantId: string) {
    // TODO: Implement segments storage
    return {
      segments: [
        {
          id: 'all-customers',
          name: 'جميع العملاء',
          count: 0,
          isSystem: true,
        },
        {
          id: 'new-customers',
          name: 'عملاء جدد (آخر 30 يوم)',
          count: 0,
          isSystem: true,
        },
        {
          id: 'vip-customers',
          name: 'عملاء VIP',
          count: 0,
          isSystem: true,
        },
        {
          id: 'inactive-customers',
          name: 'عملاء غير نشطين',
          count: 0,
          isSystem: true,
        },
      ],
    };
  }

  async createSegment(tenantId: string, dto: CreateSegmentDto) {
    // TODO: Implement segment creation
    return {
      id: 'new-segment-id',
      ...dto,
      tenantId,
      count: 0,
      createdAt: new Date(),
    };
  }

  async getSegmentById(id: string, tenantId: string) {
    // TODO: Implement
    return { id, tenantId };
  }

  async updateSegment(id: string, tenantId: string, dto: CreateSegmentDto) {
    // TODO: Implement
    return { id, ...dto };
  }

  async deleteSegment(id: string, tenantId: string) {
    // TODO: Implement
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Import/Export
  // ═══════════════════════════════════════════════════════════════════════════════

  async importContacts(
    tenantId: string,
    file: Express.Multer.File,
    dto: ImportContactsDto,
  ) {
    // TODO: Implement CSV/Excel parsing and import
    this.logger.log(`Importing contacts`, { tenantId, filename: file?.originalname });

    return {
      success: true,
      message: 'جاري استيراد العملاء',
      jobId: 'import-job-id',
    };
  }

  async exportContacts(tenantId: string, format: string, segment?: string) {
    // TODO: Implement export
    this.logger.log(`Exporting contacts`, { tenantId, format, segment });

    return {
      success: true,
      downloadUrl: '/api/v1/contacts/export/download/file-id',
      expiresAt: new Date(Date.now() + 3600000),
    };
  }
}
