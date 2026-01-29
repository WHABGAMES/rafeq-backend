/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Contacts Service (CRM)                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, Conversation, Order, CustomerStatus } from '@database/entities';
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

    // Count blocked customers
    const blocked = await this.customerRepository.count({
      where: { tenantId, status: CustomerStatus.BLOCKED },
    });

    return {
      total,
      newToday,
      newThisMonth,
      withOrders: 0,
      blocked,
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
      ].filter(Boolean) as any,
    });

    if (existing) {
      throw new BadRequestException('العميل موجود مسبقاً');
    }

    // Extract address string and other fields separately
    const { address: addressString, ...restDto } = dto;

    const contact = this.customerRepository.create({
      ...restDto,
      tenantId,
      // Convert string address to CustomerAddress if provided
      address: addressString ? { street: addressString } : undefined,
    } as any);

    const saved = await this.customerRepository.save(contact);

    // Handle both single and array results from save()
    const savedContact = Array.isArray(saved) ? saved[0] : saved;

    this.logger.log(`Contact created: ${savedContact.id}`, { tenantId, phone: dto.phone });

    return savedContact;
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
        totalSpent: 0,
        lastOrderDate: null,
        averageOrderValue: 0,
      },
    };
  }

  /**
   * تحديث عميل
   */
  async update(id: string, tenantId: string, dto: UpdateContactDto) {
    const contact = await this.customerRepository.findOne({
      where: { id, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }

    Object.assign(contact, dto);

    return this.customerRepository.save(contact);
  }

  /**
   * حذف عميل
   */
  async delete(id: string, tenantId: string) {
    const contact = await this.customerRepository.findOne({
      where: { id, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }

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
    _contactId: string,
    _tenantId: string,
    pagination: PaginationOptions,
  ) {
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
    const contact = await this.customerRepository.findOne({
      where: { id: contactId, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }
    
    const existingTags = contact.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];
    
    contact.tags = newTags;
    
    return this.customerRepository.save(contact);
  }

  /**
   * إزالة تصنيف
   */
  async removeTag(contactId: string, tenantId: string, tag: string) {
    const contact = await this.customerRepository.findOne({
      where: { id: contactId, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }
    
    contact.tags = (contact.tags || []).filter((t) => t !== tag);
    
    await this.customerRepository.save(contact);
  }

  /**
   * جلب الملاحظات
   */
  async getNotes(_contactId: string, _tenantId: string) {
    return { notes: [] };
  }

  /**
   * إضافة ملاحظة
   */
  async addNote(contactId: string, _tenantId: string, userId: string, content: string) {
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
  async deleteNote(_contactId: string, _tenantId: string, _noteId: string) {
    // TODO: Implement notes deletion
  }

  /**
   * دمج عملاء
   */
  async mergeContacts(primaryId: string, secondaryId: string, tenantId: string) {
    const primary = await this.customerRepository.findOne({
      where: { id: primaryId, tenantId },
    });

    if (!primary) {
      throw new NotFoundException('العميل الأساسي غير موجود');
    }

    const secondary = await this.customerRepository.findOne({
      where: { id: secondaryId, tenantId },
    });

    if (!secondary) {
      throw new NotFoundException('العميل الثانوي غير موجود');
    }

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
  async blockContact(contactId: string, tenantId: string, _reason?: string) {
    const contact = await this.customerRepository.findOne({
      where: { id: contactId, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }
    
    contact.status = CustomerStatus.BLOCKED;
    
    return this.customerRepository.save(contact);
  }

  /**
   * إلغاء حظر عميل
   */
  async unblockContact(contactId: string, tenantId: string) {
    const contact = await this.customerRepository.findOne({
      where: { id: contactId, tenantId },
    });

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }
    
    contact.status = CustomerStatus.ACTIVE;
    
    return this.customerRepository.save(contact);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Segments
  // ═══════════════════════════════════════════════════════════════════════════════

  async getSegments(_tenantId: string) {
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
    return {
      id: 'new-segment-id',
      ...dto,
      tenantId,
      count: 0,
      createdAt: new Date(),
    };
  }

  async getSegmentById(id: string, tenantId: string) {
    return { id, tenantId };
  }

  async updateSegment(_id: string, _tenantId: string, dto: CreateSegmentDto) {
    return { id: _id, ...dto };
  }

  async deleteSegment(_id: string, _tenantId: string) {
    // TODO: Implement
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Import/Export
  // ═══════════════════════════════════════════════════════════════════════════════

  async importContacts(
    tenantId: string,
    file: { originalname?: string },
    _dto: ImportContactsDto,
  ) {
    this.logger.log(`Importing contacts`, { tenantId, filename: file?.originalname });

    return {
      success: true,
      message: 'جاري استيراد العملاء',
      jobId: 'import-job-id',
    };
  }

  async exportContacts(tenantId: string, format: string, segment?: string) {
    this.logger.log(`Exporting contacts`, { tenantId, format, segment });

    return {
      success: true,
      downloadUrl: '/api/v1/contacts/export/download/file-id',
      expiresAt: new Date(Date.now() + 3600000),
    };
  }
}
