/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Module                               ║
 * ║                                                                                ║
 * ║  📌 إدارة الموظفين (Staff Management)                                           ║
 * ║                                                                                ║
 * ║  ⚡ يعتمد على Database فقط — لا يحتاج Redis                                     ║
 * ║                                                                                ║
 * ║  Dependencies:                                                                ║
 * ║  - TypeORM: User + Tenant entities                                            ║
 * ║  - ConfigModule: FRONTEND_URL, JWT_SECRET                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { User, Tenant } from '@database/entities';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Tenant]),
    ConfigModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
