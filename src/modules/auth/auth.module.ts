/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Module                                ║
 * ║                                                                                ║
 * ║  📌 مسؤول عن:                                                                   ║
 * ║  - تسجيل الدخول                                                                ║
 * ║  - تسجيل الخروج                                                                ║
 * ║  - تجديد الـ Token                                                             ║
 * ║  - تغيير كلمة المرور                                                           ║
 * ║  - OTP للدخول من سلة (Email + WhatsApp)                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { WhatsAppOtpService } from './whatsapp-otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User, Tenant } from '@database/entities';
import { StoresModule } from '../stores/stores.module';
import { MailModule } from '../mail/mail.module';

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

    // HTTP Module for WhatsApp API calls
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),

    // ✅ StoresModule للبحث عن المتجر بـ merchantId
    forwardRef(() => StoresModule),
    
    // ✅ MailModule لإرسال OTP عبر البريد
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    WhatsAppOtpService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    OtpService,
    WhatsAppOtpService,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
