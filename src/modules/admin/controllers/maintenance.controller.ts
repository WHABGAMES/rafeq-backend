/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║           Rafeq Platform — Maintenance Controller                             ║
 * ║                                                                                ║
 * ║  📌 API endpoints لإدارة وضع الصيانة الجزئي                                     ║
 * ║  Public: /maintenance/check (للتجار)                                           ║
 * ║  Admin:  /admin/maintenance/* (للأدمن فقط)                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MaintenanceService } from '../services/maintenance.service';
import { MaintenanceStyle } from '../entities/maintenance-page.entity';
import { AdminJwtGuard } from '../guards/admin.guards';

// ═══════════════════════════════════════════════════════════════════════════════
// Public API — يُستخدم من الفرونت إند (التاجر)
// ═══════════════════════════════════════════════════════════════════════════════

@Controller('maintenance')
export class MaintenancePublicController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  /**
   * GET /maintenance/check?route=/dashboard/conversion-elements
   * ✅ Public — لا يحتاج auth
   * ✅ Cached — 30 ثانية في الذاكرة
   */
  @Get('check')
  async checkRoute(@Query('route') route: string) {
    if (!route) return { isActive: false, style: 'overlay' };
    return this.maintenanceService.checkRoute(route);
  }

  /**
   * GET /maintenance/active-routes
   * ✅ Public — يُرجع كل الصفحات تحت الصيانة مرة واحدة
   * يُستخدم عند تحميل الداشبورد لتقليل عدد الـ requests
   */
  @Get('active-routes')
  async getActiveRoutes() {
    return this.maintenanceService.getActiveRoutes();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin API — للأدمن فقط
// ═══════════════════════════════════════════════════════════════════════════════

@Controller('admin/maintenance')
@UseGuards(AdminJwtGuard)
export class MaintenanceAdminController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  /**
   * GET /admin/maintenance
   * ✅ جلب كل الصفحات وحالتها
   */
  @Get()
  async getAll() {
    return this.maintenanceService.getAll();
  }

  /**
   * PATCH /admin/maintenance/:id/toggle
   * ✅ تفعيل/تعطيل صيانة صفحة
   */
  @Patch(':id/toggle')
  async toggle(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
    @Request() req: any,
  ) {
    const adminEmail = req.user?.email || 'admin';
    return this.maintenanceService.toggle(id, body.isActive, adminEmail);
  }

  /**
   * PATCH /admin/maintenance/:id
   * ✅ تحديث إعدادات صفحة (style, message, isActive)
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { style?: MaintenanceStyle; message?: string; isActive?: boolean },
    @Request() req: any,
  ) {
    const adminEmail = req.user?.email || 'admin';
    return this.maintenanceService.update(id, body, adminEmail);
  }
}
