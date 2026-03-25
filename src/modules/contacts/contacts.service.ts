/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Contacts Service (CRM)                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Customer, Conversation, Order, CustomerStatus, Store } from '@database/entities';
import { SallaApiService } from '../stores/salla-api.service';
import { decrypt } from '@common/utils/encryption.util';
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
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly sallaApiService: SallaApiService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ مزامنة تلقائية عند ربط متجر جديد
  // ═══════════════════════════════════════════════════════════════════════════════

  @OnEvent('store.connected')
  async handleStoreConnected(payload: { storeId: string; tenantId: string; platform: string }) {
    if (payload.platform !== 'salla') return;
    this.logger.log(`🔄 Auto-syncing customers for new store: ${payload.storeId}`);
    try {
      const result = await this.syncFromSalla(payload.tenantId);
      this.logger.log(`✅ Auto-sync complete: ${result.synced} customers synced for store ${payload.storeId}`);
    } catch (error: any) {
      this.logger.error(`❌ Auto-sync failed for store ${payload.storeId}: ${error?.message}`);
    }
  }

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
        '(customer.fullName ILIKE :search OR customer.firstName ILIKE :search OR customer.phone ILIKE :search OR customer.email ILIKE :search)',
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

    // ✅ Status filter: recently_active = طلب خلال 30 يوم، recently_inactive = ما طلب
    if (filters.status === 'recently_active') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      queryBuilder.andWhere('customer.lastOrderAt >= :thirtyDaysAgo', { thirtyDaysAgo });
    } else if (filters.status === 'recently_inactive') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      queryBuilder.andWhere('(customer.lastOrderAt IS NULL OR customer.lastOrderAt < :thirtyDaysAgo)', { thirtyDaysAgo });
    }

    // ✅ VIP filter
    if (filters.vipStatus && filters.vipStatus !== 'all') {
      if (filters.vipStatus === 'normal') {
        queryBuilder.andWhere('(customer.vipStatus IS NULL OR customer.vipStatus = :vipStatus)', { vipStatus: 'normal' });
      } else {
        queryBuilder.andWhere('customer.vipStatus = :vipStatus', { vipStatus: filters.vipStatus });
      }
    }

    // Sorting — map frontend field names to actual entity columns
    const sortFieldMap: Record<string, string> = {
      name: 'fullName',
      fullName: 'fullName',
      createdAt: 'createdAt',
      totalOrders: 'totalOrders',
      lastActivity: 'lastActivityAt',
    };
    const safeSortField = sortFieldMap[filters.sortBy || 'createdAt'] || 'createdAt';
    const sortColumn = `customer.${safeSortField}`;
    queryBuilder.orderBy(sortColumn, filters.sortOrder?.toUpperCase() as 'ASC' | 'DESC' || 'DESC');

    // Get total count
    const total = await queryBuilder.getCount();

    // ✅ Stats: count phones and emails (from ALL contacts, not just current page)
    const stats = await this.customerRepository
      .createQueryBuilder('c')
      .select([
        `COUNT(CASE WHEN c.phone IS NOT NULL AND c.phone != '' AND LENGTH(c.phone) > 6 THEN 1 END) AS "phonesCount"`,
        `COUNT(CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 1 END) AS "emailsCount"`,
      ])
      .where('c.tenantId = :tenantId', { tenantId })
      .getRawOne();

    // Get paginated results
    const contacts = await queryBuilder
      .skip(skip)
      .take(limit)
      .getMany();

    // ✅ جلب أرقام الطلبات لعملاء الصفحة الحالية فقط (أداء)
    let orderRefsMap: Record<string, string[]> = {};
    if (contacts.length > 0) {
      const customerIds = contacts.map(c => c.id);
      const orderRefs: { customerId: string; referenceId: string }[] = await this.orderRepository.manager.query(
        `SELECT customer_id AS "customerId", reference_id AS "referenceId"
         FROM orders
         WHERE customer_id = ANY($1) AND reference_id IS NOT NULL AND reference_id != ''
         ORDER BY created_at DESC`,
        [customerIds],
      );
      for (const ref of orderRefs) {
        if (!ref.customerId || !ref.referenceId) continue;
        if (!orderRefsMap[ref.customerId]) orderRefsMap[ref.customerId] = [];
        orderRefsMap[ref.customerId].push(ref.referenceId);
      }
    }

    // ✅ دمج أرقام الطلبات مع بيانات العملاء
    const contactsWithRefs = contacts.map(c => ({
      ...c,
      orderRefs: orderRefsMap[c.id] || [],
    }));

    return {
      data: contactsWithRefs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        phonesCount: parseInt(stats?.phonesCount || '0', 10),
        emailsCount: parseInt(stats?.emailsCount || '0', 10),
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

    // ✅ Active customers = طلبوا خلال آخر 30 يوم
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const active = await this.customerRepository
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.lastOrderAt >= :thirtyDaysAgo', { thirtyDaysAgo })
      .getCount();

    // ✅ VIP customers (not 'normal')
    const vip = await this.customerRepository
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.vipStatus IS NOT NULL AND c.vipStatus != :normal', { normal: 'normal' })
      .getCount();

    // ✅ Average spending + customers with orders
    const spendingStats = await this.customerRepository
      .createQueryBuilder('c')
      .select([
        `COALESCE(AVG(c.total_spent), 0) AS "avgSpent"`,
        `COUNT(CASE WHEN c.total_orders > 0 THEN 1 END) AS "withOrders"`,
      ])
      .where('c.tenantId = :tenantId', { tenantId })
      .getRawOne();

    return {
      total,
      active,
      vip,
      avgSpent: Math.round(parseFloat(spendingStats?.avgSpent || '0') * 100) / 100,
      withOrders: parseInt(spendingStats?.withOrders || '0', 10),
      newToday,
      newThisMonth,
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
  // ✅ مزامنة العملاء من سلة
  // ═══════════════════════════════════════════════════════════════════════════════

  async syncFromSalla(tenantId: string): Promise<{ synced: number; total: number; errors: number }> {
    this.logger.log(`🔄 Starting Salla customer sync`, { tenantId });

    // 1. جلب المتجر مع access token (select: false في الـ entity)
    const store = await this.storeRepository
      .createQueryBuilder('store')
      .addSelect('store.accessToken')
      .where('store.tenantId = :tenantId', { tenantId })
      .andWhere('store.platform = :platform', { platform: 'salla' })
      .andWhere('store.deletedAt IS NULL')
      .getOne();

    if (!store || !store.accessToken) {
      throw new BadRequestException('لا يوجد متجر سلة مربوط أو التوكن منتهي');
    }

    this.logger.log(`📦 Found store: ${store.id}, platform: ${store.platform}`);

    // ✅ فك تشفير التوكن (محفوظ مشفّر بـ AES-256-GCM)
    const accessToken = decrypt(store.accessToken);
    if (!accessToken) {
      throw new BadRequestException('فشل في فك تشفير التوكن — أعد ربط المتجر');
    }

    let synced = 0;
    let errors = 0;
    let page = 1;
    let hasMore = true;
    let consecutiveFailures = 0;

    // 2. جلب العملاء من سلة (كل الصفحات)
    while (hasMore) {
      try {
        const response = await this.sallaApiService.getCustomers(accessToken, {
          page,
          perPage: 50,
        });

        // ✅ Salla API: { status, success, data: [...], pagination }
        const rawData: any = response?.data;
        const customers = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.data) ? rawData.data : []);
        this.logger.log(`📦 Salla page ${page}: ${customers.length} customers received`);
        consecutiveFailures = 0; // ✅ نجحت الصفحة — reset العداد
        
        if (customers.length === 0) {
          hasMore = false;
          break;
        }

        // 3. حفظ/تحديث كل عميل
        for (const sallaCustomer of customers) {
          try {
            const sallaCustomerId = String(sallaCustomer.id);
            let customer = await this.customerRepository.findOne({
              where: { storeId: store.id, sallaCustomerId },
            });

            const firstName = sallaCustomer.first_name || undefined;
            const lastName = sallaCustomer.last_name || undefined;
            const fullName = firstName && lastName ? `${firstName} ${lastName}` : firstName || undefined;
            const email = sallaCustomer.email || undefined;

            // بناء رقم الهاتف الدولي
            const mobile = sallaCustomer.mobile != null ? String(sallaCustomer.mobile) : '';
            const mobileCode = sallaCustomer.mobile_code != null ? String(sallaCustomer.mobile_code) : '966';
            let phone: string | undefined;
            if (mobile) {
              const cleaned = mobile.replace(/\D/g, '').replace(/^0+/, '');
              const code = mobileCode.replace(/\D/g, '').replace(/^\+/, '');
              if (cleaned && cleaned.length >= 4) {
                phone = cleaned.startsWith(code) ? cleaned : `${code}${cleaned}`;
              }
              // ✅ FIX: تجاهل الأرقام القصيرة (رمز دولة فقط بدون رقم فعلي)
              if (phone && phone.replace(/\D/g, '').length < 7) phone = undefined;
            }

            if (customer) {
              // تحديث
              if (firstName) customer.firstName = firstName;
              if (lastName) customer.lastName = lastName;
              if (fullName) customer.fullName = fullName;
              if (phone) customer.phone = phone;
              if (email) customer.email = email;
              await this.customerRepository.save(customer);
            } else {
              // إنشاء
              customer = this.customerRepository.create({
                tenantId,
                storeId: store.id,
                sallaCustomerId,
                firstName,
                lastName,
                fullName,
                phone,
                email,
                status: CustomerStatus.ACTIVE,
              });
              await this.customerRepository.save(customer);
            }
            synced++;
          } catch (err: any) {
            this.logger.error(`❌ Customer sync failed for Salla ID ${sallaCustomer?.id}: ${err?.message || err}`);
            errors++;
          }
        }

        // التحقق من وجود صفحات أخرى
        if (customers.length < 50) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (error: any) {
        consecutiveFailures++;
        this.logger.error(`❌ Salla sync page ${page} failed (${consecutiveFailures}/3): ${error?.message}`);
        // ✅ 3 صفحات متتالية فشلت = وقف | غير كذا = تخطي وكمل
        if (consecutiveFailures >= 3 || page >= 250) { hasMore = false; } else { page++; errors++; }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. مزامنة الطلبات — تحديث totalOrders و totalSpent لكل عميل
    // ═══════════════════════════════════════════════════════════════════════
    try {
      this.logger.log(`📦 Syncing orders from Salla...`);
      const customerStats: Record<string, { orders: number; spent: number; lastOrderAt: string }> = {};
      const collectedOrders: { sallaOrderId: string; referenceId: string; sallaCustId: string; totalAmount: number; status: string; orderDate: string }[] = [];
      let orderPage = 1;
      let hasMoreOrders = true;
      let orderConsecFails = 0;

      while (hasMoreOrders) {
        try {
          const orderRes = await this.sallaApiService.getOrders(accessToken, { page: orderPage, perPage: 50 });
          const rawOrders: any = orderRes?.data;
          const orders = Array.isArray(rawOrders) ? rawOrders : (Array.isArray(rawOrders?.data) ? rawOrders.data : []);

          if (orders.length === 0) { hasMoreOrders = false; break; }
          orderConsecFails = 0; // ✅ نجحت

          // ✅ Log first order FULL KEYS for debugging
          if (orderPage === 1 && orders[0]) {
            this.logger.log(`📋 Sample order keys: ${Object.keys(orders[0]).join(', ')}`);
            this.logger.log(`📋 Sample order amounts: ${JSON.stringify(orders[0]?.amounts)}`);
            this.logger.log(`📋 Sample order total: ${JSON.stringify(orders[0]?.total)}`);
            this.logger.log(`📋 Sample order date: ${JSON.stringify(orders[0]?.date)}`);
          }

          for (const order of orders) {
            const custId = String(order?.customer?.id || '');
            if (!custId) continue;
            if (!customerStats[custId]) customerStats[custId] = { orders: 0, spent: 0, lastOrderAt: '' };
            customerStats[custId].orders++;
            // ✅ سلة ترسل المبلغ بأشكال مختلفة حسب الـ endpoint
            const totalAmount = order?.amounts?.total   // {amount: number, currency: string}
              ?? order?.total                            // number or {amount, currency}
              ?? order?.total_price                      // some Salla versions
              ?? order?.grand_total;                     // fallback
            const spent = typeof totalAmount === 'number' ? totalAmount
              : typeof totalAmount?.amount === 'number' ? totalAmount.amount
              : parseFloat(String(totalAmount?.amount || totalAmount || '0')) || 0;
            customerStats[custId].spent += spent;
            // ✅ تتبع آخر تاريخ طلب (سلة ترسل date كـ object أو string)
            const orderDate = order?.date?.date || order?.created_at || '';
            if (typeof orderDate === 'string' && orderDate && orderDate > customerStats[custId].lastOrderAt) {
              customerStats[custId].lastOrderAt = orderDate;
            }

            // ✅ حفظ سجل الطلب في DB (للعرض لاحقاً)
            const sallaOrderId = String(order?.id || '');
            const refId = order?.reference_id || order?.referenceId || sallaOrderId;
            const statusSlug = order?.status?.slug || order?.status?.name || 'created';
            if (sallaOrderId) {
              collectedOrders.push({
                sallaOrderId,
                referenceId: refId,
                sallaCustId: custId,
                totalAmount: spent,
                status: statusSlug,
                orderDate,
              });
            }
          }

          if (orders.length < 50) hasMoreOrders = false;
          else orderPage++;
        } catch (orderPageErr: any) {
          orderConsecFails++;
          this.logger.error(`❌ Salla orders page ${orderPage} failed (${orderConsecFails}/3): ${orderPageErr?.message || orderPageErr}`);
          if (orderConsecFails >= 3 || orderPage >= 250) { hasMoreOrders = false; } else { orderPage++; }
        }
      }

      // تحديث العملاء بالإحصائيات
      for (const [sallaId, stats] of Object.entries(customerStats)) {
        try {
          const updateData: any = {
            totalOrders: stats.orders,
            totalSpent: Math.round(stats.spent * 100) / 100,
          };
          // ✅ حفظ آخر تاريخ طلب (لحساب العملاء النشطين)
          if (stats.lastOrderAt) {
            const parsed = new Date(stats.lastOrderAt);
            if (!isNaN(parsed.getTime())) {
              updateData.lastOrderAt = parsed;
            }
          }
          await this.customerRepository
            .createQueryBuilder()
            .update()
            .set(updateData)
            .where('"store_id" = :storeId AND "salla_customer_id" = :sallaId', { storeId: store.id, sallaId })
            .execute();
        } catch {}
      }
      this.logger.log(`✅ Order stats updated for ${Object.keys(customerStats).length} customers`);

      // ✅ حفظ سجلات الطلبات في DB (batch upsert)
      if (collectedOrders.length > 0) {
        try {
          let savedCount = 0;
          let firstError = '';
          for (const o of collectedOrders) {
            try {
              // تحقق أن الطلب غير موجود مسبقاً
              const exists = await this.orderRepository.manager.query(
                `SELECT 1 FROM orders WHERE store_id = $1 AND salla_order_id = $2 LIMIT 1`,
                [store.id, o.sallaOrderId]
              );
              if (exists.length > 0) continue; // موجود → تجاوز

              // جلب customer_id الداخلي
              const custRow = await this.orderRepository.manager.query(
                `SELECT id FROM customers WHERE store_id = $1 AND salla_customer_id = $2 LIMIT 1`,
                [store.id, o.sallaCustId]
              );
              if (!custRow.length) continue; // عميل غير موجود → تجاوز

              const orderDateParsed = o.orderDate ? new Date(o.orderDate) : new Date();
              const safeDate = !isNaN(orderDateParsed.getTime()) ? orderDateParsed : new Date();

              const validStatuses = ['created', 'processing', 'under_review', 'pending_payment', 'paid', 'ready_to_ship', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded', 'restoring', 'failed', 'on_hold'];
              const safeStatus = validStatuses.includes(o.status) ? o.status : 'completed';

              // ✅ Generate UUID in JS (avoids pgcrypto dependency)
              const orderId = randomUUID();

              await this.orderRepository.manager.query(
                `INSERT INTO orders (id, tenant_id, store_id, customer_id, salla_order_id, reference_id, status, payment_status, total_amount, subtotal, discount_amount, shipping_cost, tax_amount, items, notifications_sent, currency, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, 0, 0, 0, 0, '[]'::jsonb, '[]'::jsonb, 'SAR', $9, NOW())`,
                [orderId, tenantId, store.id, custRow[0].id, o.sallaOrderId, o.referenceId, safeStatus, o.totalAmount, safeDate]
              );
              savedCount++;
            } catch (orderErr: any) {
              if (!firstError) firstError = orderErr?.message || String(orderErr);
            }
          }
          this.logger.log(`✅ Saved ${savedCount} new order records to DB (${collectedOrders.length} total from Salla)${firstError ? ` | First error: ${firstError}` : ''}`);
        } catch (err: any) {
          this.logger.warn(`⚠️ Order records save failed (non-blocking): ${err?.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`⚠️ Order sync failed: ${err?.message}`);
    }

    const total = await this.customerRepository.count({ where: { tenantId } });

    // ✅ تحديث عدد العملاء في المتجر ليتطابق مع قاعدة البيانات
    try {
      await this.storeRepository.update(
        { id: store.id },
        { sallaCustomersCount: total } as any,
      );
    } catch {}

    this.logger.log(`✅ Salla sync complete: ${synced} synced, ${errors} errors, ${total} total`, { tenantId });

    return { synced, total, errors };
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

  /**
   * ✅ تصدير العملاء كملف CSV حقيقي
   *
   * يجلب جميع العملاء للمتجر ويُنشئ CSV مع:
   * - BOM لدعم العربية في Excel
   * - أعمدة: الاسم، الهاتف، الإيميل، القناة، الطلبات، الإنفاق، التصنيفات
   */
  async exportContacts(tenantId: string, _format: string, _segment?: string): Promise<string> {
    this.logger.log(`Exporting contacts`, { tenantId, _format });

    // جلب جميع العملاء (بدون pagination)
    const customers = await this.customerRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });

    // ✅ جلب أرقام الطلبات لكل العملاء (raw SQL — يتجنب مشاكل TypeORM mapping)
    const allOrderRefs: { customerId: string; referenceId: string }[] = await this.orderRepository.manager.query(
      `SELECT customer_id AS "customerId", reference_id AS "referenceId"
       FROM orders
       WHERE tenant_id = $1 AND reference_id IS NOT NULL AND reference_id != ''
       ORDER BY created_at DESC`,
      [tenantId],
    );
    this.logger.log(`📋 CSV export: found ${allOrderRefs.length} order refs for ${customers.length} customers`);
    const orderRefsMap: Record<string, string[]> = {};
    for (const ref of allOrderRefs) {
      if (!ref.customerId || !ref.referenceId) continue;
      if (!orderRefsMap[ref.customerId]) orderRefsMap[ref.customerId] = [];
      orderRefsMap[ref.customerId].push(ref.referenceId);
    }

    // UTF-8 BOM لدعم العربية في Excel
    const BOM = '\uFEFF';

    // Headers
    const headers = ['الاسم', 'رقم الهاتف', 'الإيميل', 'القناة', 'الحالة', 'عدد الطلبات', 'أرقام الطلبات', 'إجمالي الإنفاق', 'التصنيفات', 'تاريخ التسجيل'];

    // Rows
    const rows = customers.map(c => {
      const name = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
      const phone = c.phone || '—';
      const email = c.email || '—';
      const channel = c.channel || '—';
      const status = c.status || 'active';
      const orders = String(c.totalOrders ?? 0);
      const refs = (orderRefsMap[c.id] || []).join(' | ');
      const spent = String(c.totalSpent ?? 0);
      const tags = (c.tags || []).join('، ');
      const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('ar-SA') : '—';
      return [name, phone, email, channel, status, orders, refs, spent, tags, date];
    });

    // Build CSV
    const escapeCsv = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const csvLines = [
      headers.map(escapeCsv).join(','),
      ...rows.map(row => row.map(escapeCsv).join(',')),
    ];

    return BOM + csvLines.join('\n');
  }
}
