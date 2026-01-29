/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Module                                ║
 * ║                                                                                ║
 * ║  📌 مسؤول عن:                                                                   ║
 * ║  - تسجيل الدخول                                                                ║
 * ║  - تسجيل الخروج                                                                ║
 * ║  - تجديد الـ Token                                                             ║
 * ║  - تغيير كلمة المرور                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User, Tenant } from '@database/entities';

@Module({
  imports: [
    // User & Tenant Entities للوصول لقاعدة البيانات
    TypeOrmModule.forFeature([User, Tenant]),

    // Passport للـ authentication strategies
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),

    // JWT Module
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
        signOptions: {
          expiresIn: configService.get('jwt.accessExpiration'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
