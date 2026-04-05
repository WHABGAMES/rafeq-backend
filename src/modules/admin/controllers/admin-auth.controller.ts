// ============================================================
// Admin Stores Controller
// ============================================================
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  BadRequestException,
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

@Controller('admin/stores')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AdminStoresController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  getStores(
    @Query('page') page = 1,
    @Query('limit') limit = 30,
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
    // ✅ Validate required fields before reaching the service layer
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
    @Query('page') page = 1,
    @Query('limit') limit = 20,
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
// Message Templates Controller
// ============================================================
@Controller('admin/templates')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class TemplatesController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getAll() {
    return this.notificationService.getAllTemplates();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.getTemplateById(id);
  }

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
    },
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.createTemplate(body, admin.id);
  }

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
    },
    @CurrentAdmin() admin: AdminUser,
  ) {
    return this.notificationService.updateTemplate(id, body, admin.id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationService.deleteTemplate(id);
  }

  @Post('test')
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
    return this.notificationService.sendManual(
      body.templateId,
      body.recipientPhone,
      body.variables || {},
      { recipientUserId: body.recipientUserId },
    );
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: { content: string; variables?: TemplateVariables }) {
    return {
      preview: this.notificationService.previewTemplate(
        body.content,
        body.variables || {},
      ),
    };
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
    @Query('page') page = 1,
    @Query('limit') limit = 50,
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
