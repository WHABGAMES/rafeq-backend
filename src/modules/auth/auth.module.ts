/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Module (Simplified)                  ║
 * ║                                                                                ║
 * ║  🎯 وحدة المصادقة المبسطة - Email + Password فقط                              ║
 * ║  🔧 FIX C4+L1: إضافة REDIS_CLIENT للـ Token Blacklist + Account Lockout       ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import Redis from 'ioredis';

// Entities
import { User } from '@database/entities/user.entity';
import { Tenant } from '@database/entities/tenant.entity';

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
    TypeOrmModule.forFeature([User, Tenant]),
    
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

    // 🔧 FIX C4+L1: Redis client للـ token blacklist وقفل الحساب
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('redis.host', 'localhost');
        const port = configService.get<number>('redis.port', 6379);
        const password = configService.get<string>('redis.password');
        const db = configService.get<number>('redis.db', 0);
        const useTls = process.env.REDIS_TLS === 'true';

        const redisOptions: Record<string, unknown> = {
          host,
          port,
          db,
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => {
            if (times > 3) return null;
            return Math.min(times * 200, 2000);
          },
        };

        if (password) {
          redisOptions.password = password;
        }

        if (useTls) {
          redisOptions.tls = {};
        }

        return new Redis(redisOptions as any);
      },
      inject: [ConfigService],
    },
  ],
  exports: [AuthService, AutoRegistrationService],
})
export class AuthModule {}
