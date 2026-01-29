/**
 * RAFIQ PLATFORM - Contacts Service (CRM)
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

  async findAll(
    tenantId: string,
    filters: ContactFiltersDto,
    pagination: PaginationOptions,
  ) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const queryBuilder = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId });

    if (filters.search) {
      queryBuilder.andWhere(
        '(customer.full_name ILIKE :search OR customer.phone ILIKE :search OR customer.email ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters.tags?.length) {
      queryBuilder.andWhere('customer.tags && :tags', { tags: filters.tags });
    }

    if (filters.channel) {
      queryBuilder.andWhere('customer.channel = :channel', { channel: filters.channel });
    }

    const sortColumn = `customer.${filters.sortBy || 'created_at'}`;
    queryBuilder.orderBy(sortColumn, (filters.sortOrder?.toUpperCase() as 'ASC' | 'DESC') || 'DESC');

    const total = await queryBuilder.getCount();
    const contacts = await queryBuilder.skip(skip).take(limit).getMany();

    return {
      data: contacts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getStats(tenantId: string) {
    const total = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .getCount();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newToday = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.created_at >= :today', { today })
      .getCount();

    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const newThisMonth = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.created_at >= :thisMonth', { thisMonth })
      .getCount();

    return {
      total,
      newToday,
      newThisMonth,
      withOrders: 0,
      blocked: 0,
      byChannel: { whatsapp: 0, instagram: 0, telegram: 0, email: 0, sms: 0 },
    };
  }

  async create(tenantId: string, dto: CreateContactDto) {
    const queryBuilder = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('(customer.phone = :phone OR customer.email = :email)', {
        phone: dto.phone,
        email: dto.email || '',
      });

    const existing = await queryBuilder.getOne();
    if (existing) {
      throw new BadRequestException('العميل موجود مسبقاً');
    }

    const contact = this.customerRepository.create({
      ...dto,
      tenantId,
      storeId: dto.storeId || 'default',
      sallaCustomerId: dto.sallaCustomerId || `manual-${Date.now()}`,
      status: CustomerStatus.ACTIVE,
      isEmailVerified: false,
      isPhoneVerified: false,
      totalOrders: 0,
      totalSpent: 0,
      currency: 'SAR',
      marketingConsent: false,
      tags: [],
      segments: [],
      metadata: {},
      isBlocked: false,
    } as any);

    const saved = await this.customerRepository.save(contact);
    this.logger.log(`Contact created: ${saved.id}`, { tenantId, phone: dto.phone });
    return saved;
  }

  async findById(id: string, tenantId: string): Promise<Customer> {
    const contact = await this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.id = :id', { id })
      .andWhere('customer.tenant_id = :tenantId', { tenantId })
      .getOne();

    if (!contact) {
      throw new NotFoundException('العميل غير موجود');
    }
    return contact;
  }

  async findByIdWithStats(id: string, tenantId: string) {
    const contact = await this.findById(id, tenantId);

    const conversationCount = await this.conversationRepository
      .createQueryBuilder('conv')
      .where('conv.customer_id = :id', { id })
      .andWhere('conv.tenant_id = :tenantId', { tenantId })
      .getCount();

    const orderCount = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.customer_id = :id', { id })
      .getCount();

    return {
      ...contact,
      stats: { conversationCount, orderCount, totalSpent: 0, lastOrderDate: null, averageOrderValue: 0 },
    };
  }

  async update(id: string, tenantId: string, dto: UpdateContactDto) {
    const contact = await this.findById(id, tenantId);
    Object.assign(contact, dto);
    return this.customerRepository.save(contact);
  }

  async delete(id: string, tenantId: string) {
    const contact = await this.findById(id, tenantId);
    await this.customerRepository.remove(contact);
    this.logger.log(`Contact deleted: ${id}`, { tenantId });
  }

  async getConversations(contactId: string, tenantId: string, pagination: PaginationOptions) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [conversations, total] = await this.conversationRepository
      .createQueryBuilder('conv')
      .where('conv.customer_id = :contactId', { contactId })
      .andWhere('conv.tenant_id = :tenantId', { tenantId })
      .orderBy('conv.updated_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: conversations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getOrders(contactId: string, tenantId: string, pagination: PaginationOptions) {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [orders, total] = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.customer_id = :contactId', { contactId })
      .orderBy('order.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTimeline(contactId: string, _tenantId: string, pagination: PaginationOptions) {
    return { data: [], pagination: { ...pagination, total: 0, totalPages: 0 } };
  }

  async addTags(contactId: string, tenantId: string, tags: string[]) {
    const contact = await this.findById(contactId, tenantId);
    const existingTags = contact.tags || [];
    contact.tags = [...new Set([...existingTags, ...tags])];
    return this.customerRepository.save(contact);
  }

  async removeTag(contactId: string, tenantId: string, tag: string) {
    const contact = await this.findById(contactId, tenantId);
    contact.tags = (contact.tags || []).filter((t) => t !== tag);
    await this.customerRepository.save(contact);
  }

  async getNotes(_contactId: string, _tenantId: string) {
    return { notes: [] };
  }

  async addNote(contactId: string, _tenantId: string, userId: string, content: string) {
    return { id: 'note-id', contactId, userId, content, createdAt: new Date() };
  }

  async deleteNote(_contactId: string, _tenantId: string, _noteId: string) {}

  async mergeContacts(primaryId: string, secondaryId: string, tenantId: string) {
    const primary = await this.findById(primaryId, tenantId);
    const secondary = await this.findById(secondaryId, tenantId);

    primary.tags = [...new Set([...(primary.tags || []), ...(secondary.tags || [])])];

    await this.conversationRepository
      .createQueryBuilder()
      .update()
      .set({ customerId: primaryId })
      .where('customer_id = :secondaryId', { secondaryId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .execute();

    await this.orderRepository
      .createQueryBuilder()
      .update()
      .set({ customerId: primaryId })
      .where('customer_id = :secondaryId', { secondaryId })
      .execute();

    await this.customerRepository.remove(secondary);
    return this.customerRepository.save(primary);
  }

  async blockContact(contactId: string, tenantId: string, reason?: string) {
    const contact = await this.findById(contactId, tenantId);
    contact.isBlocked = true;
    contact.blockReason = reason;
    contact.blockedAt = new Date();
    return this.customerRepository.save(contact);
  }

  async unblockContact(contactId: string, tenantId: string) {
    const contact = await this.findById(contactId, tenantId);
    contact.isBlocked = false;
    contact.blockReason = undefined;
    contact.blockedAt = undefined;
    return this.customerRepository.save(contact);
  }

  async getSegments(_tenantId: string) {
    return {
      segments: [
        { id: 'all-customers', name: 'جميع العملاء', count: 0, isSystem: true },
        { id: 'new-customers', name: 'عملاء جدد (آخر 30 يوم)', count: 0, isSystem: true },
        { id: 'vip-customers', name: 'عملاء VIP', count: 0, isSystem: true },
        { id: 'inactive-customers', name: 'عملاء غير نشطين', count: 0, isSystem: true },
      ],
    };
  }

  async createSegment(tenantId: string, dto: CreateSegmentDto) {
    return { id: 'new-segment-id', ...dto, tenantId, count: 0, createdAt: new Date() };
  }

  async getSegmentById(id: string, tenantId: string) {
    return { id, tenantId };
  }

  async updateSegment(id: string, _tenantId: string, dto: CreateSegmentDto) {
    return { id, ...dto };
  }

  async deleteSegment(_id: string, _tenantId: string) {}

  async importContacts(tenantId: string, file: any, _dto: ImportContactsDto) {
    this.logger.log(`Importing contacts`, { tenantId, filename: file?.originalname });
    return { success: true, message: 'جاري استيراد العملاء', jobId: 'import-job-id' };
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
