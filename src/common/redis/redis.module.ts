/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Redis Module (Global)                      ║
 * ║                                                                                ║
 * ║  🔗 مزوّد REDIS_CLIENT مشترك وعالمي (@Global) لكل الوحدات.                     ║
 * ║                                                                                ║
 * ║  السبب (FIX F-06 وما بعده):                                                    ║
 * ║   كان عميل Redis معرّفاً داخل AuthModule فقط وغير مُصدَّر — فأي وحدة أخرى        ║
 * ║   تحتاج Redis (مثل حد معدل OTP) كانت ستضطر لتكرار منطق الاتصال (~70 سطراً).     ║
 * ║   استخرجناه هنا كوحدة عالمية واحدة: نفس الضبط المُجرَّب (retry/keepAlive/ping)   ║
 * ║   يُحقَن في أي وحدة عبر @Inject('REDIS_CLIENT') دون تكرار.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Global, Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService): Redis => {
        const logger = new Logger('RedisModule');
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
          // keepAlive يمنع انقطاع Redis بسبب idle timeout (الخادم يغلق بعد 300s)
          keepAlive: 30000,
          reconnectOnError: (err: Error) => {
            return ['READONLY', 'ECONNRESET', 'EPIPE'].some((e) => err.message.includes(e));
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

        client.on('error', (err) => {
          logger.error(`❌ Redis error: ${err.message}`);
        });
        client.on('connect', () => {
          logger.log('✅ Redis connected');
        });
        client.on('close', () => {
          logger.warn('⚠️ Redis connection closed');
        });

        // PING تطبيقي كل 60s — يمنع idle timeout عبر بروكسيات Redis السحابية
        setInterval(async () => {
          try {
            if (client.status === 'ready') {
              await client.ping();
            }
          } catch {
            // صامت — retryStrategy يتكفّل بإعادة الاتصال
          }
        }, 60_000);

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
