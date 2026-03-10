/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Quick Replies Module                             ║
 * ║                                                                                ║
 * ║  ✅ v2: PostgreSQL persistence via TypeORM                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuickRepliesController } from './quick-replies.controller';
import { QuickRepliesService } from './quick-replies.service';
import { QuickReplyEntity } from './entities/quick-reply.entity';

@Module({
  imports: [TypeOrmModule.forFeature([QuickReplyEntity])],
  controllers: [QuickRepliesController],
  providers: [QuickRepliesService],
  exports: [QuickRepliesService],
})
export class QuickRepliesModule {}
