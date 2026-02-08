/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Module                               ║
 * ║                                                                                ║
 * ║  📌 إدارة الموظفين (Staff Management)                                           ║
 * ║                                                                                ║
 * ║  Dependencies:                                                                ║
 * ║  - TypeORM: User + Tenant entities                                            ║
 * ║  - Redis: invite tokens (72h TTL)                                             ║
 * ║  - MailModule: إرسال إيميلات الدعوة                                             ║
 * ║  - ConfigModule: FRONTEND_URL, JWT_SECRET                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { User, Tenant } from '@database/entities';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Tenant]),
    ConfigModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    // ✅ Redis Client (نفس pattern المستخدم في AuthModule)
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const host = configService.get('REDIS_HOST', 'localhost');
        const port = configService.get('REDIS_PORT', 6379);
        const password = configService.get('REDIS_PASSWORD', '');

        const redisOptions: Record<string, unknown> = {
          host,
          port: Number(port),
          maxRetriesPerRequest: 3,
          retryStrategy: (times: number) => Math.min(times * 50, 2000),
        };

        if (password) {
          redisOptions.password = password;
        }

        // ✅ Render.com Redis URL support
        const redisUrl = configService.get('REDIS_URL');
        if (redisUrl) {
          return new Redis(redisUrl);
        }

        return new Redis(redisOptions as any);
      },
      inject: [ConfigService],
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
