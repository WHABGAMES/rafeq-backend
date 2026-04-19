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
import {
  AdminJwtGuard,
  AdminPermissionGuard,
  RequirePermissions,
} from '../guards/admin.guards';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';
import {
  AdminAlertsService,
  CreateRecipientInput,
  UpdateRecipientInput,
} from '../services/admin-alerts.service';

@Controller('admin/alerts')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AdminAlertsController {
  constructor(private readonly alertsService: AdminAlertsService) {}

  // ─── META ────────────────────────────────────────────────────────────────

  @Get('meta/events')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getAvailableEvents() {
    return { events: this.alertsService.getAvailableEvents() };
  }

  // ─── Recipients CRUD ─────────────────────────────────────────────────────

  @Get('recipients')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  listRecipients() {
    return this.alertsService.getAllRecipients();
  }

  @Post('recipients')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  createRecipient(
    @Body() body: CreateRecipientInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.alertsService.createRecipient(body, admin.id);
  }

  @Get('recipients/:id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getRecipient(@Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.getRecipientById(id);
  }

  @Put('recipients/:id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  updateRecipient(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRecipientInput,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.alertsService.updateRecipient(id, body, admin.id);
  }

  @Delete('recipients/:id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecipient(@Param('id', ParseUUIDPipe) id: string) {
    await this.alertsService.deleteRecipient(id);
  }

  @Patch('recipients/:id/toggle')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  toggleRecipient(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.alertsService.toggleRecipient(id, admin.id);
  }

  @Post('recipients/:id/test')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.OK)
  sendTestAlert(@Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.sendTestAlert(id);
  }
}
