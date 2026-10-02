/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  AdminAlertsController — /admin/alerts/*                                 ║
 * ║                                                                          ║
 * ║  Endpoints:                                                              ║
 * ║   GET    /admin/alerts/recipients          — list all recipients         ║
 * ║   GET    /admin/alerts/recipients/:id      — single recipient            ║
 * ║   POST   /admin/alerts/recipients          — create recipient            ║
 * ║   PUT    /admin/alerts/recipients/:id      — update recipient            ║
 * ║   DELETE /admin/alerts/recipients/:id      — delete recipient            ║
 * ║   PATCH  /admin/alerts/recipients/:id/toggle — toggle isActive           ║
 * ║   POST   /admin/alerts/recipients/:id/test   — send test WhatsApp msg    ║
 * ║   GET    /admin/alerts/meta/events         — list available events       ║
 * ║                                                                          ║
 * ║  Security: AdminJwtGuard + AdminPermissionGuard + TEMPLATES_MANAGE       ║
 * ║    (reuses existing permission — admins who manage templates also        ║
 * ║     manage alert recipients)                                             ║
 * ║                                                                          ║
 * ║  Route ordering: static paths (meta/events) BEFORE :id routes.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AdminJwtGuard,
  AdminPermissionGuard,
  Require2FA,
  RequirePermissions,
} from '../guards/admin.guards';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';
import {
  AdminAlertsService,
} from '../services/admin-alerts.service';
import {
  CreateAdminAlertRecipientDto,
  UpdateAdminAlertRecipientDto,
} from '../dto/admin-alert-recipient.dto';

@Controller('admin/alerts')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AdminAlertsController {
  constructor(private readonly alertsService: AdminAlertsService) {}

  // ─── META ────────────────────────────────────────────────────────────────

  @Get('meta/events')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_READ)
  getAvailableEvents() {
    return { events: this.alertsService.getAvailableEvents() };
  }

  // ─── Recipients CRUD ─────────────────────────────────────────────────────

  @Get('recipients')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_READ)
  listRecipients() {
    return this.alertsService.getAllRecipients();
  }

  @Post('recipients')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_MANAGE)
  @Require2FA()
  createRecipient(
    @Body() body: CreateAdminAlertRecipientDto,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.alertsService.createRecipient(body, admin.id);
  }

  @Get('recipients/:id')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_READ)
  getRecipient(@Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.getRecipientById(id);
  }

  @Put('recipients/:id')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_MANAGE)
  @Require2FA()
  updateRecipient(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminAlertRecipientDto,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.alertsService.updateRecipient(id, body, admin.id);
  }

  @Delete('recipients/:id')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecipient(@Param('id', ParseUUIDPipe) id: string) {
    await this.alertsService.deleteRecipient(id);
  }

  @Patch('recipients/:id/toggle')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_MANAGE)
  @Require2FA()
  toggleRecipient(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.alertsService.toggleRecipient(id, admin.id);
  }

  @Post('recipients/:id/test')
  @RequirePermissions(PERMISSIONS.ADMIN_ALERTS_TEST)
  @Require2FA()
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @HttpCode(HttpStatus.OK)
  sendTestAlert(@Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.sendTestAlert(id);
  }
}
