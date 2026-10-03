import { BadRequestException, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { AdminUser, PERMISSIONS } from '../entities/admin-user.entity';
import {
  AdminJwtGuard,
  AdminPermissionGuard,
  Require2FA,
  RequirePermissions,
} from '../guards/admin.guards';
import { PlatformBackupService } from '../services/platform-backup.service';
import { AuditAction } from '../entities/audit-log.entity';
import { AuditService } from '../services/audit.service';
import { AdminIp } from '../decorators/current-admin.decorator';

@Controller('admin/backups')
@UseGuards(AdminJwtGuard, AdminPermissionGuard)
export class PlatformBackupsController {
  constructor(
    private readonly backupService: PlatformBackupService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BACKUPS_READ)
  async list(@Query('limit') rawLimit?: string) {
    const parsed = Number(rawLimit ?? 50);
    const limit = Number.isSafeInteger(parsed) ? parsed : 50;
    return {
      configuration: this.backupService.getConfiguration(),
      backups: await this.backupService.list(limit),
    };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BACKUPS_MANAGE)
  @Require2FA()
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  async create(@CurrentAdmin() admin: AdminUser, @AdminIp() ipAddress: string) {
    try {
      const backup = await this.backupService.requestManualBackup(admin.id);
      await this.auditService.log({
        actor: admin,
        action: AuditAction.BACKUP_REQUESTED,
        targetType: 'platform_backup',
        targetId: backup.id,
        ipAddress,
        metadata: { trigger: backup.trigger },
      });
      return backup;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Unable to queue backup',
      );
    }
  }
}
