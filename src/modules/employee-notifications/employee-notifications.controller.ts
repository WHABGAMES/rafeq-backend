/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - Employee Notifications Controller                    ║
 * ║                                                                                ║
 * ║  API Endpoints لإدارة قواعد التنبيهات وإشعارات الموظفين                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
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
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

// Service
import { EmployeeNotificationsService } from './employee-notifications.service';

// DTOs
import {
  CreateNotificationRuleDto,
  UpdateNotificationRuleDto,
  ToggleRuleDto,
  NotificationFilterDto,
  MarkNotificationsReadDto,
  TestNotificationRuleDto,
  TEMPLATE_VARIABLES,
} from './dto/notification.dto';

// Decorators (من نظام الصلاحيات الموجود)
import { CurrentTenant } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Employee Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('employee-notifications')
export class EmployeeNotificationsController {
  constructor(
    private readonly notificationsService: EmployeeNotificationsService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // قواعد التنبيهات (للتاجر/المدير)
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /employee-notifications/rules
   * جلب جميع قواعد التنبيهات
   */
  @Get('rules')
  @ApiOperation({ summary: 'جلب جميع قواعد التنبيهات' })
  // @Permissions('notifications:read')
  async getRules(@CurrentTenant() tenantId: string) {
    const rules = await this.notificationsService.getRules(tenantId);
    return { data: rules, total: rules.length };
  }

  /**
   * GET /employee-notifications/rules/:id
   * جلب قاعدة تنبيه واحدة
   */
  @Get('rules/:id')
  @ApiOperation({ summary: 'جلب قاعدة تنبيه واحدة' })
  // @Permissions('notifications:read')
  async getRule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.getRule(tenantId, id);
  }

  /**
   * POST /employee-notifications/rules
   * إنشاء قاعدة تنبيه جديدة
   */
  @Post('rules')
  @ApiOperation({ summary: 'إنشاء قاعدة تنبيه جديدة' })
  // @Permissions('notifications:create')
  async createRule(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateNotificationRuleDto,
  ) {
    return this.notificationsService.createRule(tenantId, dto);
  }

  /**
   * PUT /employee-notifications/rules/:id
   * تعديل قاعدة تنبيه
   */
  @Put('rules/:id')
  @ApiOperation({ summary: 'تعديل قاعدة تنبيه' })
  // @Permissions('notifications:update')
  async updateRule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationRuleDto,
  ) {
    return this.notificationsService.updateRule(tenantId, id, dto);
  }

  /**
   * PATCH /employee-notifications/rules/:id/toggle
   * تبديل حالة التفعيل
   */
  @Patch('rules/:id/toggle')
  @ApiOperation({ summary: 'تفعيل/تعطيل قاعدة تنبيه' })
  // @Permissions('notifications:update')
  async toggleRule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleRuleDto,
  ) {
    return this.notificationsService.toggleRule(tenantId, id, dto.isActive);
  }

  /**
   * DELETE /employee-notifications/rules/:id
   * حذف قاعدة تنبيه
   */
  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف قاعدة تنبيه' })
  // @Permissions('notifications:delete')
  async deleteRule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.deleteRule(tenantId, id);
  }

  /**
   * POST /employee-notifications/rules/test
   * إرسال تنبيه تجريبي
   */
  @Post('rules/test')
  @ApiOperation({ summary: 'إرسال تنبيه تجريبي' })
  // @Permissions('notifications:create')
  async testRule(
    @CurrentTenant() tenantId: string,
    @Body() dto: TestNotificationRuleDto,
  ) {
    return this.notificationsService.sendTestNotification(
      tenantId,
      dto.ruleId,
      dto.testEmployeeId,
    );
  }

  /**
   * GET /employee-notifications/template-variables
   * جلب المتغيرات المتاحة للقوالب
   */
  @Get('template-variables')
  @ApiOperation({ summary: 'جلب المتغيرات الديناميكية المتاحة' })
  getTemplateVariables() {
    return TEMPLATE_VARIABLES;
  }

  // ═══════════════════════════════════════════════════════════
  // إشعارات الموظف (Dashboard Notifications)
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /employee-notifications/my
   * جلب إشعارات الموظف الحالي
   */
  @Get('my')
  @ApiOperation({ summary: 'جلب إشعاراتي' })
  async getMyNotifications(
    @CurrentTenant() tenantId: string,
    // TODO: استخراج employeeId من الـ JWT token
    // @CurrentUser() userId: string,
    @Query() filter: NotificationFilterDto,
  ) {
    // TODO: استبدال بالـ userId الحقيقي من الـ token
    const employeeId = 'current-user-id';
    return this.notificationsService.getEmployeeNotifications(
      tenantId,
      employeeId,
      filter,
    );
  }

  /**
   * GET /employee-notifications/my/unread-count
   * عدد الإشعارات غير المقروءة
   */
  @Get('my/unread-count')
  @ApiOperation({ summary: 'عدد الإشعارات غير المقروءة' })
  async getUnreadCount(@CurrentTenant() tenantId: string) {
    // TODO: استبدال بالـ userId الحقيقي
    const employeeId = 'current-user-id';
    const count = await this.notificationsService.getUnreadCount(tenantId, employeeId);
    return { unreadCount: count };
  }

  /**
   * POST /employee-notifications/my/mark-read
   * تحديد إشعارات كمقروءة
   */
  @Post('my/mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تحديد إشعارات كمقروءة' })
  async markAsRead(
    @CurrentTenant() tenantId: string,
    @Body() dto: MarkNotificationsReadDto,
  ) {
    const employeeId = 'current-user-id';
    await this.notificationsService.markAsRead(tenantId, employeeId, dto.notificationIds);
    return { success: true };
  }

  /**
   * POST /employee-notifications/my/mark-all-read
   * تحديد جميع الإشعارات كمقروءة
   */
  @Post('my/mark-all-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تحديد جميع الإشعارات كمقروءة' })
  async markAllAsRead(@CurrentTenant() tenantId: string) {
    const employeeId = 'current-user-id';
    await this.notificationsService.markAllAsRead(tenantId, employeeId);
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // إحصائيات
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /employee-notifications/stats
   * إحصائيات التنبيهات
   */
  @Get('stats')
  @ApiOperation({ summary: 'إحصائيات التنبيهات' })
  // @Permissions('notifications:read')
  async getStats(@CurrentTenant() tenantId: string) {
    return this.notificationsService.getStats(tenantId);
  }
}
