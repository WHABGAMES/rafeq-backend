// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 FILE: src/modules/gateway/gateway.module.ts
// 🔧 FIX M4: إزالة fallback JWT secret
// ═══════════════════════════════════════════════════════════════════════════════

import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppGateway } from './app.gateway';
import { Conversation } from '@database/entities/conversation.entity';

@Global()
@Module({
  imports: [
    // 🔧 FIX H-07: Conversation repo needed for tenant isolation in WebSocket
    TypeOrmModule.forFeature([Conversation]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // 🔧 FIX M4: لا fallback - يجب أن يكون JWT_SECRET موجود
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('🚨 FATAL: JWT_SECRET is required but not set');
        }

        return {
          secret,
          signOptions: {
            expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d'),
          },
        };
      },
    }),
  ],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class GatewayModule {}
