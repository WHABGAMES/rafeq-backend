/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Module (Simplified)                  ║
 * ║                                                                                ║
 * ║  🎯 وحدة المصادقة المبسطة - Email + Password فقط                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

// Entities
import { User } from '@database/entities/user.entity';

// Controllers
import { AuthController } from './auth.controller';

// Services
import { AuthService } from './auth.service';
import { AutoRegistrationService } from './auto-registration.service';

// Strategies
import { JwtStrategy } from './strategies/jwt.strategy';

// Mail Module
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    
    PassportModule.register({ defaultStrategy: 'jwt' }),
    
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '15m'),
        },
      }),
      inject: [ConfigService],
    }),
    
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AutoRegistrationService,
    JwtStrategy,
  ],
  exports: [AuthService, AutoRegistrationService],
})
export class AuthModule {}
