import {
  Controller,
  Get,
  Post,
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
// ✅ AuditService is NOT injected here — all audit logging happens inside AdminUsersService

@Controller('admin/users')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
  ) {}

  // ─── STATIC routes MUST come before :id (NestJS top-to-bottom matching) ────

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('emailDomain') emailDomain?: string,
    @Query('hasMultipleStores') hasMultipleStores?: string,
    @Query('newRegistrations') newRegistrations?: string,
  ) {
    return this.adminUsersService.getAllUsers({
      page: +page,
      limit: Math.min(+limit, 200),
      search,
      status,
      role,
      emailDomain,
      hasMultipleStores: hasMultipleStores === 'true',
      newRegistrations: newRegistrations === 'true',
    });
  }

  /**
   * ✅ CRITICAL: GET 'merge/preview' MUST be above GET ':id'
   * NestJS evaluates routes top-to-bottom. If ':id' is first,
   * /admin/users/merge/preview would be caught with id='merge' → UUID parse error.
   */
  @Get('merge/preview')
  @RequirePermissions(PERMISSIONS.USERS_MERGE)
  previewMerge(
    @Query('sourceUserId') sourceUserId: string,
    @Query('targetUserId') targetUserId: string,
  ) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!sourceUserId || !uuidRegex.test(sourceUserId)) {
      throw new BadRequestException('sourceUserId must be a valid UUID');
    }
    if (!targetUserId || !uuidRegex.test(targetUserId)) {
      throw new BadRequestException('targetUserId must be a valid UUID');
    }
    return this.adminUsersService.previewMerge(sourceUserId, targetUserId);
  }

  @Post('merge')
  @RequirePermissions(PERMISSIONS.USERS_MERGE)
  @HttpCode(HttpStatus.OK)
  mergeAccounts(
    @Body() body: { sourceUserId: string; targetUserId: string; confirmText: string },
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    if (body.confirmText !== 'MERGE') {
      throw new BadRequestException('Confirmation text must be "MERGE"');
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(body.sourceUserId) || !uuidRegex.test(body.targetUserId)) {
      throw new BadRequestException('Invalid UUID in sourceUserId or targetUserId');
    }
    return this.adminUsersService.mergeAccounts(body.sourceUserId, body.targetUserId, admin, ip);
  }

  // ─── Dynamic :id routes ───────────────────────────────────────────────────

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.getUserById(id);
  }

  @Post(':id/suspend')
  @RequirePermissions(PERMISSIONS.USERS_SUSPEND)
  @HttpCode(HttpStatus.OK)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    if (!body.reason?.trim()) {
      throw new BadRequestException('Suspension reason is required');
    }
    return this.adminUsersService.suspendUser(id, body.reason, admin, ip);
  }

  @Post(':id/reactivate')
  @RequirePermissions(PERMISSIONS.USERS_SUSPEND)
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    return this.adminUsersService.reactivateUser(id, admin, ip);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USERS_RESET_PASSWORD)
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    return this.adminUsersService.forcePasswordReset(id, admin, ip);
  }

  @Post(':id/change-email')
  @RequirePermissions(PERMISSIONS.USERS_CHANGE_EMAIL)
  @HttpCode(HttpStatus.OK)
  changeEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { newEmail: string },
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    if (!body.newEmail?.includes('@')) {
      throw new BadRequestException('Invalid email address');
    }
    return this.adminUsersService.changeUserEmail(id, body.newEmail.toLowerCase().trim(), admin, ip);
  }

  @Post(':id/delete')
  @RequirePermissions(PERMISSIONS.USERS_DELETE)
  @HttpCode(HttpStatus.OK)
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    return this.adminUsersService.softDeleteUser(id, admin, ip);
  }
}
