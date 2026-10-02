// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Admin Controllers — multi-tenant SaaS (v3)                              ║
// ║                                                                          ║
// ║  Contains:                                                               ║
// ║    • AdminStoresController   — stores management                         ║
// ║    • WhatsappController      — global WhatsApp settings                  ║
// ║    • TemplatesController     — admin notification templates (EXPANDED)   ║
// ║    • AuditLogsController     — admin audit trail                         ║
// ║                                                                          ║
// ║  v3 changes: TemplatesController upgraded with:                          ║
// ║    • filters (event/channel/lang/status/search)                          ║
// ║    • metadata endpoints (events + variables)                             ║
// ║    • overview stats                                                      ║
// ║    • single + bulk toggle                                                ║
// ║    • duplicate                                                           ║
// ║    • version history                                                     ║
// ║    • soft delete (deleteTemplate now passes adminId for audit)          ║
// ║                                                                          ║
// ║  SECURITY: All routes guarded by AdminJwtGuard + AdminPermissionGuard    ║
// ║            + require TEMPLATES_MANAGE permission                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions, Require2FA } from '../guards/admin.guards';
import { CurrentAdmin, AdminIp } from '../decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';
import { AdminUsersService } from '../services/admin-users.service';
import { AuditService } from '../services/audit.service';
import { WhatsappSettingsService } from '../services/whatsapp-settings.service';
import { NotificationService } from '../services/notification.service';
import { AuditAction } from '../entities/audit-log.entity';
import {
  SaveAdminWhatsappSettingsDto,
  TestAdminWhatsappDto,
  ToggleAdminWhatsappDto,
} from '../dto/admin-whatsapp.dto';
import {
  BulkToggleAdminTemplatesDto,
  CreateAdminTemplateDto,
  PreviewAdminTemplateDto,
  TestAdminTemplateDto,
  UpdateAdminTemplateDto,
} from '../dto/admin-template.dto';

// ============================================================
// Admin Stores Controller
// ============================================================
@Controller('admin/stores')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AdminStoresController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  getStores(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 30,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.adminUsersService.getAllStores({ page: +page, limit: +limit, search, status });
  }

  @Post(':id/transfer')
  @RequirePermissions(PERMISSIONS.STORES_TRANSFER)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  transfer(
    @Param('id', ParseUUIDPipe) storeId: string,
    @Body() body: { targetUserId: string },
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    return this.adminUsersService.transferStore(storeId, body.targetUserId, admin, ip);
  }
}

// ============================================================
// WhatsApp Settings Controller
// ============================================================
@Controller('admin/whatsapp')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappSettingsService) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  getSettings(@Query('tenantId') tenantId?: string) {
    return this.whatsappService.getSettings(tenantId);
  }

  @Post('connect')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  connect(
    @Body() body: SaveAdminWhatsappSettingsDto,
  ) {
    return this.whatsappService.upsertSettings(body);
  }

  @Post('toggle')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  toggle(@Body() body: ToggleAdminWhatsappDto) {
    return this.whatsappService.toggleActive(body.isActive, body.tenantId);
  }

  @Get('messages')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  getMessages(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('status') status?: string,
    @Query('phone') phone?: string,
  ) {
    return this.whatsappService.getMessageLogs({
      page: +page,
      limit: Math.min(+limit, 100),
      status,
      phone,
    });
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  test(@Body() body: TestAdminWhatsappDto) {
    return this.whatsappService.sendTestMessage(body.phoneNumber, body.tenantId);
  }
}

// ============================================================
// Message Templates Controller (v3 — EXPANDED)
// ============================================================
//
// IMPORTANT: Route ordering in NestJS:
//   Static paths (meta/events, meta/variables, stats/overview, bulk-toggle,
//   preview, test, test-send) MUST be declared BEFORE :id param routes to
//   avoid `:id` catching them. NestJS matches in declaration order.
// ============================================================
@Controller('admin/templates')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class TemplatesController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly auditService: AuditService,
  ) {}

  // ─── META: trigger events registry ────────────────────────────────────
  @Get('meta/events')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getTriggerEvents() {
    return { events: this.notificationService.getTriggerEvents() };
  }

  // ─── META: variables registry ─────────────────────────────────────────
  @Get('meta/variables')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getAvailableVariables() {
    return this.notificationService.getAvailableVariables();
  }

  // ─── STATS: overview ──────────────────────────────────────────────────
  @Get('stats/overview')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getOverviewStats() {
    return this.notificationService.getOverviewStats();
  }

  // ─── LIST (with filters) ──────────────────────────────────────────────
  @Get()
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getAll(
    @Query('triggerEvent') triggerEvent?: string,
    @Query('channel') channel?: string,
    @Query('language') language?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    const filters = {
      triggerEvent: triggerEvent || undefined,
      channel: channel || undefined,
      language: language || undefined,
      isActive:
        isActive === 'true' ? true
        : isActive === 'false' ? false
        : undefined,
      search: search || undefined,
    };
    return this.notificationService.getAllTemplates(filters);
  }

  // ─── PREVIEW (render variables on arbitrary content) ──────────────────
  @Post('preview')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: PreviewAdminTemplateDto) {
    return {
      preview: this.notificationService.previewTemplate(body.content, body.variables || {}),
    };
  }

  // ─── TEST SEND ────────────────────────────────────────────────────────
  @Post('test-send')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  async testSend(
    @Body() body: TestAdminTemplateDto,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const result = await this.notificationService.sendManual(
      body.templateId,
      body.recipientPhone,
      body.variables || {},
      {
        recipientUserId: body.recipientUserId,
        recipientEmail: body.recipientEmail,
      },
    );
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_TEST_QUEUED,
      targetType: 'template',
      targetId: body.templateId,
      metadata: {
        channels: result.channels,
        hasPhoneRecipient: Boolean(body.recipientPhone),
        hasEmailRecipient: Boolean(body.recipientEmail),
      },
      ipAddress,
    });
    return result;
  }

  // ─── Legacy alias (for backward compat with existing frontend) ────────
  @Post('test')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  testSendLegacy(
    @Body() body: TestAdminTemplateDto,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    return this.testSend(body, admin, ipAddress);
  }

  // ─── BULK TOGGLE ──────────────────────────────────────────────────────
  @Post('bulk-toggle')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  @HttpCode(HttpStatus.OK)
  async bulkToggle(
    @Body() body: BulkToggleAdminTemplatesDto,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const result = await this.notificationService.bulkToggle(body.ids, body.isActive, admin.id);
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_BULK_TOGGLED,
      targetType: 'template',
      metadata: { ids: body.ids, isActive: body.isActive, affectedCount: result.count },
      ipAddress,
    });
    return result;
  }

  // ─── CREATE ───────────────────────────────────────────────────────────
  @Post()
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  async create(
    @Body() body: CreateAdminTemplateDto,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const template = await this.notificationService.createTemplate(body, admin.id);
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_CREATED,
      targetType: 'template',
      targetId: template.id,
      metadata: {
        name: template.name,
        triggerEvent: template.triggerEvent,
        channel: template.channel,
        language: template.language,
        isActive: template.isActive,
      },
      ipAddress,
    });
    return template;
  }

  // ─── GET ONE ──────────────────────────────────────────────────────────
  @Get(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.getTemplateById(id);
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────
  @Put(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminTemplateDto,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const template = await this.notificationService.updateTemplate(id, body, admin.id);
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_UPDATED,
      targetType: 'template',
      targetId: id,
      metadata: { changedFields: Object.keys(body), version: template.version },
      ipAddress,
    });
    return template;
  }

  // ─── DELETE (soft) ────────────────────────────────────────────────────
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    await this.notificationService.deleteTemplate(id, admin.id);
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_DELETED,
      targetType: 'template',
      targetId: id,
      ipAddress,
    });
  }

  // ─── SINGLE TOGGLE ────────────────────────────────────────────────────
  @Patch(':id/toggle')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  async toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const template = await this.notificationService.toggleTemplate(id, admin.id);
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_TOGGLED,
      targetType: 'template',
      targetId: id,
      metadata: { isActive: template.isActive },
      ipAddress,
    });
    return template;
  }

  // ─── DUPLICATE ────────────────────────────────────────────────────────
  @Post(':id/duplicate')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @Require2FA()
  async duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ipAddress: string,
  ) {
    const copy = await this.notificationService.duplicateTemplate(id, admin.id);
    await this.auditService.log({
      actor: admin,
      action: AuditAction.TEMPLATE_DUPLICATED,
      targetType: 'template',
      targetId: copy.id,
      metadata: { sourceTemplateId: id, name: copy.name },
      ipAddress,
    });
    return copy;
  }

  // ─── STATS: per-template ──────────────────────────────────────────────
  @Get(':id/stats')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.getTemplateStats(id);
  }
}

// ============================================================
// Audit Logs Controller
// ============================================================
@Controller('admin/audit-logs')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AuditLogsController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  getLogs(
    @Query('actorId') actorId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('action') action?: string,
    @Query('actionPrefix') actionPrefix?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    return this.auditService.getAuditLogs({
      actorId,
      tenantId,
      targetType,
      targetId,
      action,
      actionPrefix,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: +page,
      limit: +limit,
    });
  }
}
