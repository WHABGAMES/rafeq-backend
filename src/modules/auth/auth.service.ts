/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Service (Simplified)                 ║
 * ║                                                                                ║
 * ║  🎯 خدمات المصادقة المبسطة:                                                    ║
 * ║  - تسجيل دخول بالإيميل + الباسورد                                              ║
 * ║  - تجديد التوكن                                                                ║
 * ║  - تغيير كلمة المرور                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import { User, UserStatus } from '@database/entities/user.entity';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    avatar?: string;
  };
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  role: string;
  tenantId: string;
  preferences?: Record<string, any>;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════════

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔑 LOGIN
  // ═══════════════════════════════════════════════════════════════════════════════

  async login(email: string, password: string): Promise<LoginResult> {
    this.logger.log(`Login attempt for: ${email}`);

    // Find user with password
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'password', 'firstName', 'lastName', 'role', 'avatar', 'tenantId', 'status'],
    });

    if (!user) {
      this.logger.warn(`Login failed: User not found - ${email}`);
      throw new UnauthorizedException('البريد الإلكتروني أو رمز الدخول غير صحيح');
    }

    // Check status
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`Login failed: User inactive - ${email}`);
      throw new UnauthorizedException('الحساب غير مفعّل');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Login failed: Invalid password - ${email}`);
      throw new UnauthorizedException('البريد الإلكتروني أو رمز الدخول غير صحيح');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Update last login
    await this.userRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    this.logger.log(`✅ Login successful: ${email}`);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔄 REFRESH TOKENS
  // ═══════════════════════════════════════════════════════════════════════════════

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'email', 'tenantId', 'role', 'status'],
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('المستخدم غير موجود أو غير مفعّل');
      }

      return this.generateTokens(user);
    } catch (error: any) {
      this.logger.warn(`Token refresh failed: ${error.message}`);
      throw new UnauthorizedException('التوكن غير صالح أو منتهي الصلاحية');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚪 LOGOUT
  // ═══════════════════════════════════════════════════════════════════════════════

  async logout(userId: string): Promise<void> {
    this.logger.log(`User logged out: ${userId}`);
    // يمكن إضافة token blacklist هنا إذا لزم
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 👤 GET USER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════════

  async getUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName', 'lastName', 'phone', 'avatar', 'role', 'tenantId', 'preferences', 'createdAt'],
    });

    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      tenantId: user.tenantId,
      preferences: user.preferences,
      createdAt: user.createdAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════════════════════════

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    // Get user with password
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password', 'preferences'],
    });

    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('رمز الدخول الحالي غير صحيح');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new BadRequestException('رمز الدخول الجديد يجب أن يكون 8 أحرف على الأقل');
    }

    // Hash and save new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    await this.userRepository.update(userId, {
      password: hashedPassword,
      preferences: {
        ...(user.preferences || {}),
        hasSetPassword: true,
        passwordChangedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`✅ Password changed for user: ${userId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎟️ GENERATE TOKENS (Private)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async generateTokens(user: Pick<User, 'id' | 'email' | 'tenantId' | 'role'>): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
