/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Subscription Plan Service                        ║
 * ║                                                                                ║
 * ║  📌 إدارة خطط الاشتراك المتاحة                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PlanStatus, SubscriptionPlan } from '@database/entities/subscription-plan.entity';

@Injectable()
export class SubscriptionPlanService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,
  ) {}

  /**
   * جلب جميع الخطط النشطة
   */
  async findAll(): Promise<SubscriptionPlan[]> {
    return this.planRepository.find({
      where: { status: PlanStatus.ACTIVE },
      order: { displayOrder: 'ASC' },
    });
  }

  /**
   * جلب خطة بالـ ID
   */
  async findById(id: string): Promise<SubscriptionPlan> {
    const plan = await this.planRepository.findOne({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException('الخطة غير موجودة');
    }

    return plan;
  }

  /**
   * جلب خطة بالـ Slug
   */
  async findBySlug(slug: string): Promise<SubscriptionPlan> {
    const plan = await this.planRepository.findOne({
      where: { slug },
    });

    if (!plan) {
      throw new NotFoundException('الخطة غير موجودة');
    }

    return plan;
  }

  /**
   * إنشاء خطة جديدة (Admin only)
   */
  async create(data: Partial<SubscriptionPlan>): Promise<SubscriptionPlan> {
    const plan = this.planRepository.create(data);
    return this.planRepository.save(plan);
  }

  /**
   * تحديث خطة (Admin only)
   */
  async update(
    id: string,
    data: Partial<SubscriptionPlan>,
  ): Promise<SubscriptionPlan> {
    const plan = await this.findById(id);
    Object.assign(plan, data);
    return this.planRepository.save(plan);
  }
}
