/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Plans Controller                                 ║
 * ║                                                                                ║
 * ║  📌 نقاط الوصول لخطط الاشتراك                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { SubscriptionPlanService } from '../services/subscription-plan.service';

@ApiTags('Billing - Plans')
@Controller({
  path: 'billing/plans',
  version: '1',
})
export class PlansController {
  constructor(
    private readonly planService: SubscriptionPlanService,
  ) {}

  /**
   * جلب جميع الخطط المتاحة
   */
  @Get()
  @ApiOperation({
    summary: 'جلب خطط الاشتراك',
    description: 'جلب جميع خطط الاشتراك المتاحة للعرض',
  })
  @ApiResponse({ status: 200, description: 'قائمة الخطط' })
  async getPlans() {
    return this.planService.findAll();
  }

  /**
   * جلب خطة معينة
   */
  @Get(':slug')
  @ApiOperation({
    summary: 'جلب خطة معينة',
    description: 'جلب تفاصيل خطة اشتراك بالـ slug',
  })
  async getPlan(@Param('slug') slug: string) {
    return this.planService.findBySlug(slug);
  }
}
