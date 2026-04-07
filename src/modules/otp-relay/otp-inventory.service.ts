import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { OtpConfig } from './entities/otp-config.entity';
import { OtpInventoryItem, OtpCompensation, InventoryStatus } from './entities/otp-inventory.entity';
import { Store } from '../stores/entities/store.entity';
import { Channel, ChannelType, ChannelStatus } from '../channels/entities/channel.entity';
import { WhatsAppBaileysService } from '../channels/whatsapp/whatsapp-baileys.service';
import { SallaApiService } from '../stores/salla-api.service';
import { decrypt } from '@common/utils/encryption.util';

@Injectable()
export class OtpInventoryService {
  private readonly logger = new Logger(OtpInventoryService.name);

  constructor(
    @InjectRepository(OtpConfig) private readonly configRepo: Repository<OtpConfig>,
    @InjectRepository(OtpInventoryItem) private readonly inventoryRepo: Repository<OtpInventoryItem>,
    @InjectRepository(OtpCompensation) private readonly compensationRepo: Repository<OtpCompensation>,
    @InjectRepository(Store) private readonly storeRepo: Repository<Store>,
    @InjectRepository(Channel) private readonly channelRepo: Repository<Channel>,
    private readonly whatsapp: WhatsAppBaileysService,
    private readonly sallaApi: SallaApiService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📦 INVENTORY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  async addItem(configId: string, tenantId: string, data: { accountData: string; accountLabel?: string; notes?: string }): Promise<OtpInventoryItem> {
    const config = await this.getConfigSafe(configId, tenantId);
    const item = this.inventoryRepo.create({
      configId, tenantId, storeId: config.storeId,
      accountData: data.accountData.trim(),
      accountLabel: data.accountLabel?.trim(),
      notes: data.notes?.trim(),
      status: InventoryStatus.AVAILABLE,
    });
    const saved = await this.inventoryRepo.save(item);
    await this.refreshInventoryCount(configId);
    return saved;
  }

  async bulkAdd(configId: string, tenantId: string, data: { accounts: string; accountLabel?: string }): Promise<{ added: number }> {
    const config = await this.getConfigSafe(configId, tenantId);
    const lines = data.accounts.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw new BadRequestException('لا توجد حسابات');
    if (lines.length > 500) throw new BadRequestException('الحد الأقصى 500 حساب في المرة الواحدة');

    const items = lines.map(line => this.inventoryRepo.create({
      configId, tenantId, storeId: config.storeId,
      accountData: line,
      accountLabel: data.accountLabel?.trim(),
      status: InventoryStatus.AVAILABLE,
    }));

    await this.inventoryRepo.save(items, { chunk: 100 });
    await this.refreshInventoryCount(configId);
    this.logger.log(`📦 Bulk added ${items.length} items to config ${configId}`);
    return { added: items.length };
  }

  async listItems(configId: string, tenantId: string, filters?: { status?: string; page?: number; limit?: number }): Promise<{ items: OtpInventoryItem[]; total: number; stats: any }> {
    await this.getConfigSafe(configId, tenantId);
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 50, 200);

    const qb = this.inventoryRepo.createQueryBuilder('i')
      .where('i.configId = :configId AND i.tenantId = :tenantId', { configId, tenantId })
      .orderBy('i.createdAt', 'DESC')
      .skip((page - 1) * limit).take(limit);

    if (filters?.status) qb.andWhere('i.status = :status', { status: filters.status });

    const [items, total] = await qb.getManyAndCount();

    const stats = await this.inventoryRepo.createQueryBuilder('i')
      .select('i.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('i.configId = :configId', { configId })
      .groupBy('i.status')
      .getRawMany();

    return { items, total, stats };
  }

  async deleteItem(itemId: string, tenantId: string): Promise<void> {
    const item = await this.inventoryRepo.findOne({ where: { id: itemId, tenantId } as any });
    if (!item) throw new NotFoundException('العنصر غير موجود');
    if (item.status === InventoryStatus.ASSIGNED) throw new BadRequestException('لا يمكن حذف حساب تم تعيينه لطلب');
    await this.inventoryRepo.remove(item);
    await this.refreshInventoryCount(item.configId);
  }

  async deleteAllAvailable(configId: string, tenantId: string): Promise<{ deleted: number }> {
    await this.getConfigSafe(configId, tenantId);
    const result = await this.inventoryRepo.delete({ configId, tenantId, status: InventoryStatus.AVAILABLE } as any);
    await this.refreshInventoryCount(configId);
    return { deleted: result.affected || 0 };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎁 COMPENSATION
  // ═══════════════════════════════════════════════════════════════════════════════

  async requestCompensation(slug: string, orderNumber: string, username: string, clientIp: string): Promise<any> {
    orderNumber = (orderNumber || '').trim();
    username = (username || '').trim();

    const config = await this.configRepo.findOne({ where: { slug, isActive: true } as any });
    if (!config) throw new NotFoundException('الخدمة غير متوفرة');
    if (!config.compensationEnabled) throw new BadRequestException('خدمة التعويضات غير مفعلة');

    if (config.verifyOrder && orderNumber) {
      await this.verifyOrderExists(config.storeId, orderNumber);
    }

    if (config.maxCompensationsPerOrder > 0) {
      const used = await this.compensationRepo.count({
        where: { configId: config.id, orderNumber } as any,
      });
      if (used >= config.maxCompensationsPerOrder) {
        return {
          success: false,
          message: config.compensationLimitMsg || 'تم استنفاد عدد التعويضات المسموحة لهذا الطلب.',
          limitReached: true, used, max: config.maxCompensationsPerOrder,
        };
      }
    }

    // ── سحب حساب (FIFO + pessimistic lock) ──
    const item = await this.inventoryRepo.createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.configId = :configId AND i.status = :status', {
        configId: config.id, status: InventoryStatus.AVAILABLE,
      })
      .orderBy('i.createdAt', 'ASC')
      .getOne();

    if (!item) {
      return {
        success: false,
        message: config.compensationEmptyMsg || 'عذراً، لا توجد حسابات متاحة حالياً.',
        outOfStock: true,
      };
    }

    item.status = InventoryStatus.ASSIGNED;
    item.assignedToOrder = orderNumber;
    item.assignedToUsername = username || undefined;
    item.assignedAt = new Date();
    await this.inventoryRepo.save(item);

    let customerName: string | undefined;
    let customerPhone: string | undefined;
    try {
      const orderData = await this.getOrderInfo(config.storeId, orderNumber);
      customerName = orderData?.customerName;
      customerPhone = orderData?.customerPhone;
    } catch {}

    const compensation = this.compensationRepo.create({
      configId: config.id, tenantId: config.tenantId, storeId: config.storeId,
      inventoryItemId: item.id,
      orderNumber, username: username || undefined,
      accountDataSnapshot: item.accountData,
      customerName, customerPhone, clientIp,
    });
    await this.compensationRepo.save(compensation);

    await this.configRepo.increment({ id: config.id } as any, 'totalCompensations', 1);
    await this.refreshInventoryCount(config.id);

    this.sendCompensationNotifications(config, orderNumber, username, item.accountData, customerName, customerPhone).catch(e =>
      this.logger.warn(`📦 Notification failed: ${e?.message}`),
    );

    this.logger.log(`🎁 Compensation: order=${orderNumber}, item=${item.id.slice(0, 8)}`);

    return {
      success: true,
      message: config.compensationSuccessMsg || 'تم تعويضك بحساب جديد بنجاح ✅',
      accountData: item.accountData,
      accountLabel: item.accountLabel,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCompensationStats(configId: string, tenantId: string, days = 30): Promise<any> {
    await this.getConfigSafe(configId, tenantId);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const inventoryStats = await this.inventoryRepo.createQueryBuilder('i')
      .select('i.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('i.configId = :configId', { configId })
      .groupBy('i.status')
      .getRawMany();

    const compensations = await this.compensationRepo.find({
      where: { configId, createdAt: MoreThan(since) } as any,
      order: { createdAt: 'DESC' } as any,
      take: 100,
    });

    const daily: Record<string, number> = {};
    compensations.forEach(c => {
      const day = c.createdAt.toISOString().split('T')[0];
      daily[day] = (daily[day] || 0) + 1;
    });

    const topOrders = await this.compensationRepo.createQueryBuilder('c')
      .select('c.orderNumber', 'orderNumber')
      .addSelect('COUNT(*)', 'count')
      .where('c.configId = :configId', { configId })
      .groupBy('c.orderNumber')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    return {
      inventory: {
        total: inventoryStats.reduce((s: number, r: any) => s + +r.count, 0),
        available: +((inventoryStats.find((r: any) => r.status === 'available')?.count) || 0),
        assigned: +((inventoryStats.find((r: any) => r.status === 'assigned')?.count) || 0),
      },
      compensations: {
        total: compensations.length, daily,
        recentList: compensations.slice(0, 20).map(c => ({
          id: c.id, orderNumber: c.orderNumber, username: c.username,
          customerName: c.customerName, createdAt: c.createdAt,
        })),
        topOrders,
      },
    };
  }

  async listCompensations(configId: string, tenantId: string, page = 1, limit = 30): Promise<{ items: OtpCompensation[]; total: number }> {
    await this.getConfigSafe(configId, tenantId);
    const [items, total] = await this.compensationRepo.findAndCount({
      where: { configId, tenantId } as any,
      order: { createdAt: 'DESC' } as any,
      skip: (page - 1) * limit,
      take: Math.min(limit, 200),
    });
    return { items, total };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔔 NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  private async sendCompensationNotifications(
    config: OtpConfig, orderNumber: string, username: string,
    accountData: string, customerName?: string, customerPhone?: string,
  ): Promise<void> {
    const channelId = await this.findWhatsAppChannel(config.storeId);
    if (!channelId) return;

    const vars: Record<string, string> = {
      '{رقم_الطلب}': orderNumber || '',
      '{اسم_العميل}': customerName || 'عميل',
      '{رقم_العميل}': customerPhone || '',
      '{اسم_الحساب}': username || '',
      '{بيانات_التعويض}': accountData,
    };

    if (config.compensationNotifyEmployee && config.employeePhones) {
      const template = config.compensationEmployeeTemplate || `🎁 تعويض جديد\n\n📦 رقم الطلب: #{رقم_الطلب}\n👤 العميل: {اسم_العميل}\n💰 التعويض:\n{بيانات_التعويض}`;
      const message = this.renderTemplate(template, vars);
      const phones = String(config.employeePhones).split(',').map(p => p.trim().replace(/[^0-9+]/g, '')).filter(p => p.length >= 9);
      for (const phone of phones) {
        try { await this.whatsapp.sendTextMessage(channelId, phone, message); } catch {}
      }
    }

    if (config.compensationNotifyCustomer && customerPhone) {
      const template = config.compensationCustomerTemplate || `✅ تم تعويضك بحساب جديد\n\n📦 رقم الطلب: #{رقم_الطلب}\n\n💰 بيانات حسابك:\n{بيانات_التعويض}\n\n⚠️ لا تشارك هذه البيانات مع أي شخص`;
      const message = this.renderTemplate(template, vars);
      const phone = String(customerPhone).replace(/[^0-9+]/g, '');
      if (phone.length >= 9) {
        try { await this.whatsapp.sendTextMessage(channelId, phone, message); } catch {}
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔧 HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  private async getConfigSafe(id: string, tenantId: string): Promise<OtpConfig> {
    const c = await this.configRepo.findOne({ where: { id, tenantId } as any });
    if (!c) throw new NotFoundException('غير موجود');
    return c;
  }

  private async refreshInventoryCount(configId: string): Promise<void> {
    const total = await this.inventoryRepo.count({ where: { configId } as any });
    const available = await this.inventoryRepo.count({ where: { configId, status: InventoryStatus.AVAILABLE } as any });
    await this.configRepo.update(configId, { inventoryTotal: total, inventoryAvailable: available } as any);
  }

  private async findWhatsAppChannel(storeId: string): Promise<string | null> {
    const ch = await this.channelRepo.findOne({
      where: { storeId, type: ChannelType.WHATSAPP_QR, status: ChannelStatus.CONNECTED } as any,
    });
    return ch?.id || null;
  }

  private async verifyOrderExists(storeId: string, orderNumber: string): Promise<void> {
    const store = await this.storeRepo.createQueryBuilder('s').addSelect('s.accessToken')
      .where('s.id = :storeId AND s.deletedAt IS NULL', { storeId }).getOne();
    if (!store?.accessToken || store.platform !== 'salla') throw new BadRequestException('المتجر غير متصل');
    const token = decrypt(store.accessToken);
    if (!token) throw new BadRequestException('تعذر التحقق');
    const order = await this.sallaApi.searchOrderByReference(token, orderNumber);
    if (!order) throw new NotFoundException('رقم الطلب غير موجود');
  }

  private async getOrderInfo(storeId: string, orderNumber: string): Promise<{ customerName?: string; customerPhone?: string } | null> {
    try {
      const store = await this.storeRepo.createQueryBuilder('s').addSelect('s.accessToken')
        .where('s.id = :storeId AND s.deletedAt IS NULL', { storeId }).getOne();
      if (!store?.accessToken || store.platform !== 'salla') return null;
      const token = decrypt(store.accessToken);
      if (!token) return null;
      const order = await this.sallaApi.searchOrderByReference(token, orderNumber);
      if (!order) return null;
      return {
        customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim() || undefined,
        customerPhone: String(order.customer?.mobile || '').replace(/[^0-9+]/g, '') || undefined,
      };
    } catch { return null; }
  }

  private renderTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(key, value);
    }
    return result.split('\n').filter(line => !line.match(/:\s*$/)).join('\n');
  }
}
