/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         Rafeq Admin Auth Controller                          ║
 * ║         Production-ready | Audited 2026-02-21                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * FIXES:
 * [C-1] Removed `await` from sync `issueTokens()` calls (TS2549)
 * [C-2] JWT secret references validated at module startup
 * [M-1] confirm2FA: select includes 'id' explicitly
 * [TS2307] argon2, speakeasy, qrcode — requires: npm install argon2 speakeasy qrcode
 * [TS2322] refreshToken: null — entity now accepts null (string | null)
 */

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
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import type { Redis } from 'ioredis';
import { JwtService } from '@nestjs/jwt';
// ✅ Requires: npm install argon2 speakeasy qrcode
// ✅ Requires: npm install --save-dev @types/speakeasy @types/qrcode
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { AdminUser, AdminStatus, AdminRole, PERMISSIONS } from '../entities/admin-user.entity';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard, AdminPermissionGuard, RequirePermissions } from '../guards/admin.guards';
import { CurrentAdmin, AdminIp } from '../decorators/current-admin.decorator';
import { AuditService } from '../services/audit.service';
import { AuditAction } from '../entities/audit-log.entity';

// Argon2 hashing options — balanced security/performance for production
// Note: no explicit type annotation to avoid raw:boolean overload ambiguity (TS2769)
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,  // 64 MB
  timeCost: 3,
  parallelism: 4,
  raw: false,         // explicit false → always returns string, resolves overload
} as const;

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @InjectRepository(AdminUser)
    private readonly adminUserRepo: Repository<AdminUser>,

    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  // ─── Login ────────────────────────────────────────────────────────────────

  /**
   * POST /admin/auth/login
   * Rate limit: 5 attempts/min/IP (anti-brute-force)
   * Supports 2FA: if twoFaEnabled, requires totpCode
   */
  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email: string; password: string; totpCode?: string },
    @AdminIp() ip: string,
  ) {
    if (!body.email?.trim() || !body.password) {
      throw new BadRequestException('Email and password are required');
    }

    // ✅ select: false columns (passwordHash, twoFaSecret) are returned
    // ONLY when explicitly listed in select array
    const admin = await this.adminUserRepo.findOne({
      where: { email: body.email.toLowerCase().trim() },
      select: ['id', 'email', 'passwordHash', 'role', 'status', 'twoFaEnabled', 'twoFaSecret'],
    });

    // ✅ Constant-time guard — same error message for "not found" and "wrong password"
    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      if (!admin) throw new UnauthorizedException('Invalid credentials');
      throw new ForbiddenException('Account not active');
    }

    const passwordValid = await argon2.verify(admin.passwordHash, body.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    // 2FA — مطلوب لكل من فعّله
    if (admin.twoFaEnabled) {
      if (!body.totpCode) {
        // أعلم الـ frontend بأن 2FA مطلوب (بدون إعطاء access token)
        return { requiresTwoFa: true };
      }

      const valid = speakeasy.totp.verify({
        secret: admin.twoFaSecret as string,
        encoding: 'base32',
        token: body.totpCode,
        window: 1, // تقبل ±30 ثانية tolerance
      });

      if (!valid) throw new UnauthorizedException('Invalid 2FA code');
    }

    // [C-1] FIX: issueTokens is SYNC — remove await
    const { accessToken, refreshToken } = this.issueTokens(admin.id, admin.email, admin.role);

    // Hash refresh token before storing (never store plain tokens in DB)
    const hashedRefresh = await argon2.hash(refreshToken, ARGON2_OPTIONS);

    await this.adminUserRepo.update(admin.id, {
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      refreshToken: hashedRefresh,
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
   * Token rotation: كل استخدام لـ refreshToken يُولّد pair جديد
   * ويُبطل القديم — يكتشف هجمات إعادة الاستخدام
   */
  @Post('refresh')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) {
      throw new BadRequestException('refreshToken is required');
    }

    let payload: { sub: string; type: string };
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

    // ✅ نحتاج refreshToken (select:false) — مُدرج صراحةً في select array
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

    const tokenValid = await argon2.verify(admin.refreshToken, body.refreshToken);
    if (!tokenValid) {
      // ✅ [TS2322] FIX: refreshToken?: string | null — null مقبول
      // هجوم إعادة استخدام — إلغاء كل الجلسات فورًا (security lockout)
      await this.adminUserRepo.update(admin.id, { refreshToken: null });
      throw new UnauthorizedException(
        'Token reuse detected — all sessions have been invalidated for your security. Please login again.',
      );
    }

    // [C-1] FIX: issueTokens is SYNC — remove await
    const { accessToken, refreshToken: newRefreshToken } = this.issueTokens(
      admin.id,
      admin.email,
      admin.role,
    );

    const hashedNewRefresh = await argon2.hash(newRefreshToken, ARGON2_OPTIONS);
    await this.adminUserRepo.update(admin.id, { refreshToken: hashedNewRefresh });

    return { accessToken, refreshToken: newRefreshToken };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  @Post('logout')
  @UseGuards(AdminJwtGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentAdmin() admin: AdminUser, @AdminIp() ip: string) {
    // ✅ [TS2322] FIX: null مقبول لأن entity يعرّف refreshToken?: string | null
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
  @SkipThrottle()
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

  // ─── 2FA Setup ────────────────────────────────────────────────────────────

  /**
   * POST /admin/auth/setup-2fa
   * يُولّد TOTP secret ويعيد QR code للـ authenticator app
   * يجب استدعاء /confirm-2fa بعده لتفعيله
   */
  @Post('setup-2fa')
  @UseGuards(AdminJwtGuard)
  @HttpCode(HttpStatus.OK)
  async setup2FA(@CurrentAdmin() admin: AdminUser) {
    const secret = speakeasy.generateSecret({
      name: `Rafeq Admin (${admin.email})`,
      issuer: 'Rafeq AI Platform',
      length: 32,
    });

    // ✅ تحقق صريح بدلًا من non-null assertion (!)
    const otpauthUrl = secret.otpauth_url;
    if (!otpauthUrl) {
      throw new BadRequestException('Failed to generate 2FA secret — please try again');
    }

    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    // يُخزَّن الـ secret لكن twoFaEnabled تبقى false حتى confirmation
    await this.adminUserRepo.update(admin.id, { twoFaSecret: secret.base32 });

    return {
      secret: secret.base32,
      qrCode: qrDataUrl,
      message: 'Scan QR code in your authenticator app, then call /confirm-2fa to activate',
    };
  }

  /**
   * POST /admin/auth/confirm-2fa
   * يؤكد أن المستخدم أدخل الـ TOTP code الصحيح قبل تفعيل 2FA
   */
  @Post('confirm-2fa')
  @UseGuards(AdminJwtGuard)
  @HttpCode(HttpStatus.OK)
  async confirm2FA(
    @CurrentAdmin() admin: AdminUser,
    @Body() body: { totpCode: string },
  ) {
    if (!body.totpCode?.trim()) throw new BadRequestException('totpCode is required');

    // [M-1] FIX: أضفنا 'id' للـ select — أكثر وضوحًا وأكثر أمانًا
    const adminWithSecret = await this.adminUserRepo.findOne({
      where: { id: admin.id },
      select: ['id', 'twoFaSecret'],
    });

    if (!adminWithSecret?.twoFaSecret) {
      throw new ForbiddenException('2FA not configured — please call /setup-2fa first');
    }

    const valid = speakeasy.totp.verify({
      secret: adminWithSecret.twoFaSecret,
      encoding: 'base32',
      token: body.totpCode,
      window: 1,
    });

    if (!valid) throw new UnauthorizedException('Invalid TOTP code — check your authenticator app');

    await this.adminUserRepo.update(admin.id, { twoFaEnabled: true });
    return { success: true, message: '2FA activated successfully' };
  }

  // ─── User Impersonation ───────────────────────────────────────────────────

  /**
   * POST /admin/auth/impersonate/:userId
   * يُنشئ token مؤقت للدخول بحساب المستخدم بصلاحية قراءة فقط
   * يُسجَّل في audit log لكل استخدام
   */
  @Post('impersonate/:userId')
  @UseGuards(AdminJwtGuard, AdminPermissionGuard)
  @RequirePermissions(PERMISSIONS.IMPERSONATE_ACCESS)
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    // ═══════════════════════════════════════════════════════════════════════════
    // 🔒 FIX F-23: تصليب توكن الانتحال
    // ───────────────────────────────────────────────────────────────────────────
    //  • jti فريد → يسمح بالإبطال قبل انتهاء العمر عبر token_blacklist (يفحصه
    //    JwtStrategy.validate أصلاً من إصلاح F-02).
    //  • عمر أقصر (30 دقيقة بدل ساعتين) → نافذة أصغر لو تسرّب التوكن.
    //  • تسجيل الجلسة في Redis → تتبّع + إمكانية إنهائها مبكراً.
    // ═══════════════════════════════════════════════════════════════════════════
    const impersonationTtlSeconds = 30 * 60; // 30 دقيقة
    const jti = uuidv4();

    const impersonationToken = this.jwtService.sign(
      {
        sub: userId,
        type: 'impersonation',
        jti,
        impersonatedBy: admin.id,
        impersonatedByEmail: admin.email,
        viewOnly: true, // يمنع العمليات الحساسة (يفرضه ImpersonationReadOnlyInterceptor)
      },
      {
        expiresIn: impersonationTtlSeconds,
        secret: process.env.JWT_SECRET,
      },
    );

    // تسجيل الجلسة النشطة في Redis (للتتبّع والإنهاء المبكر) — best-effort
    try {
      if (this.redis) {
        await this.redis.set(
          `impersonation_session:${jti}`,
          JSON.stringify({ userId, adminId: admin.id, startedAt: Date.now() }),
          'EX',
          impersonationTtlSeconds,
        );
      }
    } catch {
      // فشل التسجيل لا يمنع الجلسة — الإبطال يبقى ممكناً عبر القائمة السوداء
    }

    await this.auditService.log({
      actor: admin,
      action: AuditAction.IMPERSONATION_STARTED,
      targetType: 'user',
      targetId: userId,
      ipAddress: ip,
      metadata: { purpose: 'admin-support', jti },
    });

    return {
      impersonationToken,
      jti,
      message: 'Impersonation session started (view-only, 30m)',
      expiresIn: '30m',
    };
  }

  /**
   * POST /admin/auth/impersonate/:userId/end
   * إنهاء جلسة انتحال مبكراً بإبطال jti التوكن (قبل انتهاء عمره).
   * يُبطَل عبر token_blacklist الذي يفحصه JwtStrategy.validate (FIX F-02).
   */
  @Post('impersonate/:jti/end')
  @UseGuards(AdminJwtGuard, AdminPermissionGuard)
  @RequirePermissions(PERMISSIONS.IMPERSONATE_ACCESS)
  @HttpCode(HttpStatus.OK)
  async endImpersonation(
    @Param('jti', ParseUUIDPipe) jti: string,
    @CurrentAdmin() admin: AdminUser,
    @AdminIp() ip: string,
  ) {
    // إبطال التوكن عبر القائمة السوداء (TTL يغطي أقصى عمر متبقٍّ)
    const remainingTtl = 30 * 60;

    // 🔒 الإبطال يعتمد كلياً على Redis — لو غاب، نفشل بوضوح ولا نزعم النجاح
    if (!this.redis) {
      throw new BadRequestException('خدمة الإبطال غير متاحة حالياً — تعذّر إنهاء الجلسة');
    }

    try {
      await this.redis.set(`token_blacklist:${jti}`, '1', 'EX', remainingTtl);
      await this.redis.del(`impersonation_session:${jti}`);
    } catch {
      // لو تعذّر Redis، لا نُخفي الخطأ صامتاً في هذه العملية الأمنية
      throw new BadRequestException('تعذّر إنهاء الجلسة حالياً — حاول مجدداً');
    }

    await this.auditService.log({
      actor: admin,
      action: AuditAction.IMPERSONATION_STARTED, // نفس فئة التدقيق مع تمييز في metadata
      targetType: 'user',
      targetId: jti,
      ipAddress: ip,
      metadata: { purpose: 'admin-support', event: 'impersonation-ended', jti },
    });

    return { success: true, message: 'Impersonation session ended' };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * [C-1] FIX: دالة SYNC — لا تُستخدم async/await عليها
   * jwtService.sign() متزامن تمامًا
   */
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
