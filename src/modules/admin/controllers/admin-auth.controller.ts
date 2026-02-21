import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { AdminUser, AdminStatus, AdminRole, PERMISSIONS } from '../entities/admin-user.entity';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { CurrentAdmin, AdminIp } from '../decorators/current-admin.decorator';
import { AuditService } from '../services/audit.service';
import { AuditAction } from '../entities/audit-log.entity';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUserRepo: Repository<AdminUser>,

    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Login ────────────────────────────────────────────────────────────────

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // ✅ Max 5 login attempts per minute per IP
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email: string; password: string; totpCode?: string },
    @AdminIp() ip: string,
  ) {
    if (!body.email || !body.password) {
      throw new BadRequestException('Email and password are required');
    }

    const admin = await this.adminUserRepo.findOne({
      where: { email: body.email.toLowerCase().trim() },
      select: ['id', 'email', 'passwordHash', 'role', 'status', 'twoFaEnabled', 'twoFaSecret'],
    });

    if (!admin) throw new UnauthorizedException('Invalid credentials');
    if (admin.status !== AdminStatus.ACTIVE) throw new ForbiddenException('Account not active');

    const passwordValid = await argon2.verify(admin.passwordHash, body.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    // 2FA check — required for OWNER, optional for others who enabled it
    if (admin.twoFaEnabled) {
      if (!body.totpCode) {
        return { requiresTwoFa: true };
      }

      const valid = speakeasy.totp.verify({
        secret: admin.twoFaSecret!,
        encoding: 'base32',
        token: body.totpCode,
        window: 1,
      });

      if (!valid) throw new UnauthorizedException('Invalid 2FA code');
    }

    const { accessToken, refreshToken } = await this.issueTokens(admin.id, admin.email, admin.role);

    await this.adminUserRepo.update(admin.id, {
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      refreshToken: await argon2.hash(refreshToken, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      }),
    });

    await this.auditService.log({
      actor: admin,
      action: AuditAction.ADMIN_LOGIN,
      ipAddress: ip,
    });

    return {
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
    };
  }

  // ─── Token Refresh ────────────────────────────────────────────────────────

  /**
   * POST /admin/auth/refresh
   * Validates stored refresh token hash, issues new access + refresh tokens
   * Implements rotation: old refresh token is invalidated on use
   */
  @Post('refresh')
  @Throttle({ default: { ttl: 60000, limit: 20 } }) // Refresh up to 20/min
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) {
      throw new BadRequestException('refreshToken is required');
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(body.refreshToken, {
        secret: process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'admin_refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const admin = await this.adminUserRepo.findOne({
      where: { id: payload.sub },
      select: ['id', 'email', 'role', 'status', 'refreshToken'],
    });

    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    if (!admin.refreshToken) {
      throw new UnauthorizedException('Session invalidated — please login again');
    }

    // Verify the stored hash matches
    const tokenValid = await argon2.verify(admin.refreshToken, body.refreshToken);
    if (!tokenValid) {
      // Possible token reuse attack — invalidate all sessions
      await this.adminUserRepo.update(admin.id, { refreshToken: null });
      throw new UnauthorizedException('Token mismatch — all sessions invalidated for security');
    }

    // ✅ Rotation: generate new pair and invalidate old
    const { accessToken, refreshToken: newRefreshToken } = await this.issueTokens(
      admin.id,
      admin.email,
      admin.role,
    );

    await this.adminUserRepo.update(admin.id, {
      refreshToken: await argon2.hash(newRefreshToken, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      }),
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(AdminJwtGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentAdmin() admin: AdminUser, @AdminIp() ip: string) {
    await this.adminUserRepo.update(admin.id, { refreshToken: null });

    await this.auditService.log({
      actor: admin,
      action: AuditAction.ADMIN_LOGOUT,
      ipAddress: ip,
    });

    return { success: true };
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  @Get('me')
  @SkipThrottle() // Skip rate limit for /me — called frequently by layout
  @UseGuards(AdminJwtGuard)
  getMe(@CurrentAdmin() admin: AdminUser) {
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      role: admin.role,
      status: admin.status,
      twoFaEnabled: admin.twoFaEnabled,
    };
  }

  // ─── 2FA Setup ───────────────────────────────────────────────────────────

  @Post('setup-2fa')
  @UseGuards(AdminJwtGuard)
  @HttpCode(HttpStatus.OK)
  async setup2FA(@CurrentAdmin() admin: AdminUser) {
    const secret = speakeasy.generateSecret({
      name: `Rafeq Admin (${admin.email})`,
      issuer: 'Rafeq AI',
      length: 32,
    });

    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url!);

    await this.adminUserRepo.update(admin.id, {
      twoFaSecret: secret.base32,
    });

    return { secret: secret.base32, qrCode: qrDataUrl };
  }

  @Post('confirm-2fa')
  @UseGuards(AdminJwtGuard)
  @HttpCode(HttpStatus.OK)
  async confirm2FA(
    @CurrentAdmin() admin: AdminUser,
    @Body() body: { totpCode: string },
  ) {
    if (!body.totpCode) throw new BadRequestException('totpCode is required');

    const adminWithSecret = await this.adminUserRepo.findOne({
      where: { id: admin.id },
      select: ['twoFaSecret'],
    });

    if (!adminWithSecret?.twoFaSecret) {
      throw new ForbiddenException('2FA not set up');
    }

    const valid = speakeasy.totp.verify({
      secret: adminWithSecret.twoFaSecret,
      encoding: 'base32',
      token: body.totpCode,
      window: 1,
    });

    if (!valid) throw new UnauthorizedException('Invalid code');

    await this.adminUserRepo.update(admin.id, { twoFaEnabled: true });
    return { success: true };
  }

  // ─── Impersonation ───────────────────────────────────────────────────────

  @Post('impersonate/:userId')
  @UseGuards(AdminJwtGuard, AdminPermissionGuard)
  @RequirePermissions(PERMISSIONS.IMPERSONATE_ACCESS)
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    const impersonationToken = this.jwtService.sign(
      {
        sub: userId,
        type: 'impersonation',
        impersonatedBy: admin.id,
        impersonatedByEmail: admin.email,
        viewOnly: true, // Prevents sensitive mutations during impersonation
      },
      { expiresIn: '2h', secret: process.env.JWT_SECRET },
    );

    await this.auditService.log({
      actor: admin,
      action: AuditAction.IMPERSONATION_STARTED,
      targetType: 'user',
      targetId: userId,
      ipAddress: ip,
    });

    return {
      impersonationToken,
      message: 'Impersonation session started (view-only)',
      expiresIn: '2h',
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private issueTokens(adminId: string, email: string, role: AdminRole) {
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

    const accessToken = this.jwtService.sign(
      { sub: adminId, email, role, type: 'admin' },
      { expiresIn: '8h', secret },
    );

    const refreshToken = this.jwtService.sign(
      { sub: adminId, type: 'admin_refresh' },
      { expiresIn: '30d', secret },
    );

    return { accessToken, refreshToken };
  }
}
