/**
 * Admin Guards
 * Audited 2026-02-21
 *
 * FIX [TS6133]: Removed unused ROLE_PERMISSIONS import
 * — permission checking is delegated to AdminUser.hasPermission()
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// ✅ FIX [TS6133]: Removed ROLE_PERMISSIONS — not used directly in guards
import { AdminUser, AdminStatus, Permission } from '../entities/admin-user.entity';

// ─── Metadata Keys ────────────────────────────────────────────────────────────
export const PERMISSIONS_KEY = 'admin_permissions';
export const REQUIRE_2FA_KEY = 'require_2fa';

// ─── Decorators ───────────────────────────────────────────────────────────────
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const Require2FA = () => SetMetadata(REQUIRE_2FA_KEY, true);

// ─── Admin JWT Auth Guard ─────────────────────────────────────────────────────

/**
 * يتحقق من صحة الـ JWT token ويضع admin في الـ request
 * يجب استخدامه قبل AdminPermissionGuard
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(AdminUser)
    private readonly adminUserRepository: Repository<AdminUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Admin authentication required');
    }

    const token = authHeader.slice(7);

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
      });

      // ✅ تحقق من نوع الـ token — يمنع استخدام platform tokens كـ admin tokens
      if (payload.type !== 'admin') {
        throw new UnauthorizedException('Invalid token type for admin access');
      }

      const admin = await this.adminUserRepository.findOne({
        where: { id: payload.sub },
      });

      if (!admin) {
        throw new UnauthorizedException('Admin account not found');
      }

      if (admin.status !== AdminStatus.ACTIVE) {
        throw new ForbiddenException('Admin account is suspended or deleted');
      }

      // ✅ يُضاف للـ request — يُستخدَم من @CurrentAdmin() decorator
      request.admin = admin;
      request.ipAddress = this.extractIp(request);
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired admin token');
    }
  }

  private extractIp(request: any): string {
    return (
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.headers['x-real-ip'] ||
      request.ip ||
      'unknown'
    );
  }
}

// ─── Admin Permission Guard ───────────────────────────────────────────────────

/**
 * يتحقق من صلاحيات الأدمن باستخدام @RequirePermissions() decorator
 * يجب استخدامه بعد AdminJwtGuard (يفترض وجود request.admin)
 */
@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // لا توجد صلاحيات مطلوبة → السماح بالمرور
    if (!requiredPermissions?.length) return true;

    const { admin } = context.switchToHttp().getRequest();

    if (!admin) {
      throw new UnauthorizedException('Not authenticated as admin');
    }

    // ✅ AdminUser.hasPermission() يفحص ROLE_PERMISSIONS للـ role
    const hasAll = requiredPermissions.every((permission) =>
      admin.hasPermission(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
