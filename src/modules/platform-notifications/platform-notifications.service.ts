/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM — Platform Notifications Service                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PlatformNotification,
  PlatformNotificationType,
  PlatformNotificationDisplay,
  PlatformNotificationColor,
} from './platform-notification.entity';

export interface CreateNotificationDto {
  type?: PlatformNotificationType;
  displayType: PlatformNotificationDisplay;
  title?: string;
  message: string;
  link?: string;
  linkLabel?: string;
  colorScheme?: PlatformNotificationColor;
  bgColor?: string;
  textColor?: string;
  icon?: string;
  isScrolling?: boolean;
  isDismissible?: boolean;
  targetPlans?: string[];
  showOnPages?: string[];
  showOnLogin?: boolean;
  startsAt?: Date;
  endsAt?: Date;
  repeatHours?: number;
  priority?: number;
  isActive?: boolean;
}

export interface UpdateNotificationDto extends Partial<CreateNotificationDto> {}

@Injectable()
export class PlatformNotificationsService {
  private readonly logger = new Logger(PlatformNotificationsService.name);

  constructor(
    @InjectRepository(PlatformNotification)
    private readonly repo: Repository<PlatformNotification>,
  ) {}

  // ─── Admin CRUD ───────────────────────────────────────────────────────────

  async findAll(filters?: {
    type?: PlatformNotificationType;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ items: PlatformNotification[]; total: number }> {
    const qb = this.repo.createQueryBuilder('n').orderBy('n.priority', 'DESC').addOrderBy('n.createdAt', 'DESC');

    if (filters?.type) qb.andWhere('n.type = :type', { type: filters.type });
    if (filters?.isActive !== undefined) qb.andWhere('n.isActive = :isActive', { isActive: filters.isActive });

    const page  = filters?.page  || 1;
    const limit = filters?.limit || 50;
    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async findById(id: string): Promise<PlatformNotification> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Platform notification not found: ${id}`);
    return item;
  }

  async create(dto: CreateNotificationDto, adminId?: string): Promise<PlatformNotification> {
    const notification = this.repo.create({
      type:          dto.type          || PlatformNotificationType.CUSTOM,
      displayType:   dto.displayType,
      title:         dto.title,
      message:       dto.message,
      link:          dto.link,
      linkLabel:     dto.linkLabel,
      colorScheme:   dto.colorScheme   || PlatformNotificationColor.BLUE,
      bgColor:       dto.bgColor,
      textColor:     dto.textColor,
      icon:          dto.icon,
      isScrolling:   dto.isScrolling   ?? false,
      isDismissible: dto.isDismissible ?? true,
      targetPlans:   dto.targetPlans   || [],
      showOnPages:   dto.showOnPages   || [],
      showOnLogin:   dto.showOnLogin   ?? false,
      startsAt:      dto.startsAt      ? new Date(dto.startsAt) : undefined,
      endsAt:        dto.endsAt        ? new Date(dto.endsAt)   : undefined,
      repeatHours:   dto.repeatHours,
      priority:      dto.priority      || 0,
      isActive:      dto.isActive      ?? true,
      createdBy:     adminId,
    });

    const saved = await this.repo.save(notification);
    this.logger.log(`✅ Created platform notification: ${saved.id} (${saved.displayType})`);
    return saved;
  }

  async update(id: string, dto: UpdateNotificationDto): Promise<PlatformNotification> {
    const notification = await this.findById(id);

    Object.assign(notification, {
      ...(dto.type          !== undefined && { type:          dto.type }),
      ...(dto.displayType   !== undefined && { displayType:   dto.displayType }),
      ...(dto.title         !== undefined && { title:         dto.title }),
      ...(dto.message       !== undefined && { message:       dto.message }),
      ...(dto.link          !== undefined && { link:          dto.link }),
      ...(dto.linkLabel     !== undefined && { linkLabel:     dto.linkLabel }),
      ...(dto.colorScheme   !== undefined && { colorScheme:   dto.colorScheme }),
      ...(dto.bgColor       !== undefined && { bgColor:       dto.bgColor }),
      ...(dto.textColor     !== undefined && { textColor:     dto.textColor }),
      ...(dto.icon          !== undefined && { icon:          dto.icon }),
      ...(dto.isScrolling   !== undefined && { isScrolling:   dto.isScrolling }),
      ...(dto.isDismissible !== undefined && { isDismissible: dto.isDismissible }),
      ...(dto.targetPlans   !== undefined && { targetPlans:   dto.targetPlans }),
      ...(dto.showOnPages   !== undefined && { showOnPages:   dto.showOnPages }),
      ...(dto.showOnLogin   !== undefined && { showOnLogin:   dto.showOnLogin }),
      ...(dto.startsAt      !== undefined && { startsAt:      dto.startsAt ? new Date(dto.startsAt) : undefined }),
      ...(dto.endsAt        !== undefined && { endsAt:        dto.endsAt   ? new Date(dto.endsAt)   : undefined }),
      ...(dto.repeatHours   !== undefined && { repeatHours:   dto.repeatHours }),
      ...(dto.priority      !== undefined && { priority:      dto.priority }),
      ...(dto.isActive      !== undefined && { isActive:      dto.isActive }),
    });

    return this.repo.save(notification);
  }

  async delete(id: string): Promise<void> {
    const notification = await this.findById(id);
    await this.repo.remove(notification);
    this.logger.log(`🗑️ Deleted platform notification: ${id}`);
  }

  async toggleActive(id: string): Promise<PlatformNotification> {
    const notification = await this.findById(id);
    notification.isActive = !notification.isActive;
    return this.repo.save(notification);
  }

  // ─── Merchant-facing ──────────────────────────────────────────────────────

  /**
   * يجلب الإشعارات النشطة للتاجر حسب:
   * - باقته (plan)
   * - الصفحة الحالية (page)
   * - التوقيت (starts_at / ends_at)
   */
  async getActiveForMerchant(params: {
    plan: string;
    page?: string;
  }): Promise<PlatformNotification[]> {
    const now = new Date();

    const all = await this.repo.find({
      where: { isActive: true },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });

    return all.filter(n => {
      // تحقق من التوقيت
      if (n.startsAt && n.startsAt > now) return false;
      if (n.endsAt   && n.endsAt   < now) return false;

      // تحقق من الباقة
      if (n.targetPlans.length > 0) {
        const planMap: Record<string, string[]> = {
          free:       ['free', 'none'],
          basic:      ['basic'],
          pro:        ['pro', 'professional'],
          enterprise: ['enterprise'],
        };
        const merchantPlanKeys = planMap[params.plan] || [params.plan];
        const match = n.targetPlans.some(tp =>
          merchantPlanKeys.includes(tp) || merchantPlanKeys.includes(tp.toLowerCase()),
        );
        if (!match) return false;
      }

      // تحقق من الصفحة
      if (n.showOnPages.length > 0 && params.page) {
        const match = n.showOnPages.some(p =>
          params.page!.startsWith(p) || params.page === p,
        );
        if (!match) return false;
      }

      return true;
    });
  }

  async trackView(id: string): Promise<void> {
    await this.repo.increment({ id }, 'viewsCount', 1);
  }

  async trackDismissal(id: string): Promise<void> {
    await this.repo.increment({ id }, 'dismissalsCount', 1);
  }
}
