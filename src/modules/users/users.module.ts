/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Users Module                               ║
 * ║                                                                                ║
 * ║  📌 إدارة مستخدمي المتجر (موظفين)                                               ║
 * ║                                                                                ║
 * ║  الـ Endpoints:                                                                ║
 * ║  GET    /users          → قائمة المستخدمين                                     ║
 * ║  GET    /users/:id      → مستخدم معين                                          ║
 * ║  POST   /users          → إنشاء مستخدم (invite)                                ║
 * ║  PATCH  /users/:id      → تحديث مستخدم                                         ║
 * ║  DELETE /users/:id      → حذف مستخدم                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@database/entities';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
