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
  ParseUUIDPipe,
} from '@nestjs/common';
import { MaintenanceService } from '../services/maintenance.service';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions, Require2FA } from '../guards/admin.guards';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';
import { CheckMaintenanceRouteDto, ToggleMaintenanceDto, UpdateMaintenanceDto } from '../dto/maintenance.dto';

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
  async checkRoute(@Query() query: CheckMaintenanceRouteDto) {
    return this.maintenanceService.checkRoute(query.route);
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
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
@RequirePermissions(PERMISSIONS.MAINTENANCE_MANAGE)
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
  @Require2FA()
  async toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ToggleMaintenanceDto,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.maintenanceService.toggle(id, body.isActive, admin);
  }

  /**
   * PATCH /admin/maintenance/:id
   * ✅ تحديث إعدادات صفحة (style, message, isActive)
   */
  @Patch(':id')
  @Require2FA()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMaintenanceDto,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.maintenanceService.update(id, body, admin);
  }
}
