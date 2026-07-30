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
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { CurrentAdmin, AdminIp } from '../decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';
import { AdminUsersService } from '../services/admin-users.service';
import { AuditService } from '../services/audit.service';
import { WhatsappSettingsService } from '../services/whatsapp-settings.service';
import { NotificationService, TemplateVariables } from '../services/notification.service';
import { WhatsappProvider } from '../entities/whatsapp-settings.entity';
import { TriggerEvent, MessageChannel, MessageLanguage } from '../entities/message-template.entity';

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
  @HttpCode(HttpStatus.OK)
  connect(
    @Body()
    body: {
      tenantId?: string;
      phoneNumber: string;
      provider: WhatsappProvider;
      accessToken: string;
      businessAccountId?: string;
      phoneNumberId?: string;
      webhookUrl?: string;
      webhookVerifyToken?: string;
    },
  ) {
    if (!body.phoneNumber?.trim()) {
      throw new BadRequestException('phoneNumber is required');
    }
    if (!body.accessToken?.trim()) {
      throw new BadRequestException('accessToken is required — cannot encrypt an empty token');
    }
    if (!body.provider) {
      throw new BadRequestException('provider is required');
    }
    return this.whatsappService.upsertSettings(body);
  }

  @Post('toggle')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @HttpCode(HttpStatus.OK)
  toggle(@Body() body: { isActive: boolean; tenantId?: string }) {
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
  @HttpCode(HttpStatus.OK)
  test(@Body() body: { phoneNumber: string; tenantId?: string }) {
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
  constructor(private readonly notificationService: NotificationService) {}

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
  preview(@Body() body: { content: string; variables?: TemplateVariables }) {
    if (!body?.content) {
      throw new BadRequestException('content is required');
    }
    return {
      preview: this.notificationService.previewTemplate(body.content, body.variables || {}),
    };
  }

  // ─── TEST SEND ────────────────────────────────────────────────────────
  @Post('test-send')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.OK)
  testSend(
    @Body()
    body: {
      templateId: string;
      recipientPhone: string;
      variables?: TemplateVariables;
      recipientUserId?: string;
    },
  ) {
    if (!body?.templateId) throw new BadRequestException('templateId is required');
    if (!body?.recipientPhone) throw new BadRequestException('recipientPhone is required');
    return this.notificationService.sendManual(
      body.templateId,
      body.recipientPhone,
      body.variables || {},
      { recipientUserId: body.recipientUserId },
    );
  }

  // ─── Legacy alias (for backward compat with existing frontend) ────────
  @Post('test')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.OK)
  testSendLegacy(
    @Body()
    body: {
      templateId: string;
      recipientPhone: string;
      variables?: TemplateVariables;
      recipientUserId?: string;
    },
  ) {
    return this.testSend(body);
  }

  // ─── BULK TOGGLE ──────────────────────────────────────────────────────
  @Post('bulk-toggle')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.OK)
  bulkToggle(
    @Body() body: { ids: string[]; isActive: boolean },
    @CurrentAdmin() admin: AdminUser,
  ) {
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids array is required');
    }
    if (typeof body.isActive !== 'boolean') {
      throw new BadRequestException('isActive boolean is required');
    }
    return this.notificationService.bulkToggle(body.ids, body.isActive, admin.id);
  }

  // ─── CREATE ───────────────────────────────────────────────────────────
  @Post()
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  create(
    @Body()
    body: {
      name: string;
      triggerEvent: TriggerEvent;
      channel: MessageChannel;
      language: MessageLanguage;
      content: string;
      subject?: string;
      isActive?: boolean;
    },
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.createTemplate(body, admin.id);
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
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      content?: string;
      subject?: string;
      isActive?: boolean;
      triggerEvent?: TriggerEvent;
      channel?: MessageChannel;
      language?: MessageLanguage;
    },
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.updateTemplate(id, body, admin.id);
  }

  // ─── DELETE (soft) ────────────────────────────────────────────────────
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.deleteTemplate(id, admin.id);
  }

  // ─── SINGLE TOGGLE ────────────────────────────────────────────────────
  @Patch(':id/toggle')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.toggleTemplate(id, admin.id);
  }

  // ─── DUPLICATE ────────────────────────────────────────────────────────
  @Post(':id/duplicate')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.duplicateTemplate(id, admin.id);
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
