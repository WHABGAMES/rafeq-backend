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
// FIXED:
//   [BUG-2] accessToken أصبح optional في body — للتحديث بدون تغيير الـ token
//   [BUG-3] إضافة validation لـ phoneNumberId عند provider = META
// ============================================================
@Controller('admin/whatsapp')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappSettingsService) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  getSettings() {
    return this.whatsappService.getSettings();
  }

  @Post('connect')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @HttpCode(HttpStatus.OK)
  connect(
    @Body()
    body: {
      phoneNumber: string;
      provider: WhatsappProvider;
      accessToken?: string;        // [BUG-2 FIX] optional — عند التحديث يمكن تركه للاحتفاظ بالقديم
      businessAccountId?: string;
      phoneNumberId?: string;
      webhookUrl?: string;
      webhookVerifyToken?: string;
    },
  ) {
    if (!body.phoneNumber?.trim()) {
      throw new BadRequestException('phoneNumber is required');
    }
    if (!body.provider) {
      throw new BadRequestException('provider is required');
    }
    // [BUG-3 FIX] phoneNumberId مطلوب لـ META
    if (body.provider === WhatsappProvider.META && !body.phoneNumberId?.trim()) {
      throw new BadRequestException(
        'phoneNumberId is required for Meta provider',
      );
    }
    // accessToken validation مُفوَّض للـ service (يعرف هل هو create أم update)
    return this.whatsappService.upsertSettings(body);
  }

  @Post('toggle')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @HttpCode(HttpStatus.OK)
  toggle(@Body() body: { isActive: boolean }) {
    return this.whatsappService.toggleActive(body.isActive);
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.WHATSAPP_MANAGE)
  @HttpCode(HttpStatus.OK)
  test(@Body() body: { phoneNumber: string }) {
    return this.whatsappService.sendTestMessage(body.phoneNumber);
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
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.auditService.getAuditLogs({
      actorId,
      targetType,
      targetId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: +page,
      limit: +limit,
    });
  }
}
