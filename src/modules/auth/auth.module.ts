/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Auth Module                                ║
 * ║                                                                                ║
 * ║  ✅ v6: Multi-Auth Support                                                     ║
 * ║  🔑 Email + Password | 📧 OTP | 🔵 Google | 🟢 Salla | 🟣 Zid               ║
 * ║  📱 WhatsApp Business API لإرسال بيانات الدخول                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { HttpModule } from '@nestjs/axios';
import Redis from 'ioredis';

// Entities
import { User } from '@database/entities/user.entity';
import { Tenant } from '@database/entities/tenant.entity';

// Controllers
import { AuthController } from './auth.controller';

// Services
import { AuthService } from './auth.service';
import { AutoRegistrationService } from './auto-registration.service';
import { OtpService } from './otp.service';

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
    ConfigModule,

    // 📱 HttpModule للـ WhatsApp Business API
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 3,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AutoRegistrationService,
    OtpService,
    JwtStrategy,

    // Redis client للـ token blacklist وقفل الحساب
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('AuthModule:Redis');
        const redisUrl = configService.get<string>('REDIS_URL');
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const password = configService.get<string>('REDIS_PASSWORD');
        const db = configService.get<number>('REDIS_DB', 0);
        const useTls = configService.get<string>('REDIS_TLS') === 'true';

        const baseOptions: Record<string, unknown> = {
          maxRetriesPerRequest: 5,
          retryStrategy: (times: number) => {
            if (times > 10) {
              logger.error('❌ Redis: max retries exceeded');
              return null;
            }
            return Math.min(times * 1000, 5000);
          },
          enableReadyCheck: true,
          reconnectOnError: (err: Error) => {
            return ['READONLY', 'ECONNRESET', 'EPIPE'].some(e => err.message.includes(e));
          },
        };

        let client: Redis;

        if (redisUrl) {
          client = new Redis(redisUrl, baseOptions as any);
        } else {
          client = new Redis({
            host,
            port,
            db,
            password: password || undefined,
            ...(useTls && { tls: { rejectUnauthorized: false } }),
            ...baseOptions,
          } as any);
        }

        // ✅ Error handler to prevent unhandled crashes & log spam
        client.on('error', (err) => {
          logger.error(`❌ Redis error: ${err.message}`);
        });

        client.on('connect', () => {
          logger.log('✅ Redis connected');
        });

        client.on('close', () => {
          logger.warn('⚠️ Redis connection closed');
        });

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [AuthService, AutoRegistrationService, OtpService],
})
export class AuthModule {}
