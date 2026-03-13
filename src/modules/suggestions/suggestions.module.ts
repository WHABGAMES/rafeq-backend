/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestions Module                               ║
 * ║                                                                                ║
 * ║  📌 نظام الاقتراحات والمشاكل — ملاحظات التجار وخارطة التطوير                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';

import { Suggestion } from './entities/suggestion.entity';
import { SuggestionLike } from './entities/suggestion-like.entity';
import { SuggestionComment } from './entities/suggestion-comment.entity';
import { SuggestionFollower } from './entities/suggestion-follower.entity';

import { SuggestionsService } from './suggestions.service';
import { SuggestionsController } from './suggestions.controller';
import { AdminSuggestionsController } from './admin-suggestions.controller';

// ✅ AdminJwtGuard needs Repository<AdminUser> + JwtService
import { AdminUser } from '@modules/admin/entities/admin-user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Suggestion,
      SuggestionLike,
      SuggestionComment,
      SuggestionFollower,
      AdminUser, // required by AdminJwtGuard → @InjectRepository(AdminUser)
    ]),

    // ✅ FIX: AdminJwtGuard يستخدم jwtService.verify() مع secret في وقت التنفيذ
    // فقط نحتاج تسجيل JwtModule لتوفير JwtService في السياق
    JwtModule.register({}),
  ],
  controllers: [
    SuggestionsController,
    AdminSuggestionsController,
  ],
  providers: [SuggestionsService],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
