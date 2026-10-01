/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - Suggestions Service                              ║
 * ║                                                                                ║
 * ║  Business logic for suggestions, voting, comments, followers, merge            ║
 * ║                                                                                ║
 * ║  🔒 SECURITY NOTES:                                                            ║
 * ║  - sanitizeForPublic() → strips merchant identity if anonymous                ║
 * ║  - sanitizeForAdmin()  → exposes real identity (admin panel only)             ║
 * ║  - toggleLike/Follow   → race-condition safe with try/catch on UNIQUE         ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, In, IsNull } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  Suggestion,
  SuggestionStatus,
} from './entities/suggestion.entity';
import { SuggestionLike } from './entities/suggestion-like.entity';
import { SuggestionComment } from './entities/suggestion-comment.entity';
import { SuggestionFollower } from './entities/suggestion-follower.entity';

import {
  CreateSuggestionDto,
  CreateCommentDto,
  AdminCreateCommentDto,
  UpdateSuggestionStatusDto,
  MergeSuggestionsDto,
  ListSuggestionsQueryDto,
} from './dto';

interface DatabaseErrorWithCode {
  code?: unknown;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as DatabaseErrorWithCode).code === '23505';
}

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    @InjectRepository(Suggestion)
    private readonly suggestionRepo: Repository<Suggestion>,

    @InjectRepository(SuggestionLike)
    private readonly likeRepo: Repository<SuggestionLike>,

    @InjectRepository(SuggestionComment)
    private readonly commentRepo: Repository<SuggestionComment>,

    @InjectRepository(SuggestionFollower)
    private readonly followerRepo: Repository<SuggestionFollower>,

    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // 📋 LIST SUGGESTIONS (public board — merchant facing)
  // ═══════════════════════════════════════════════════════════════════════════

  async list(query: ListSuggestionsQueryDto, currentUserId?: string) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    const qb = this.suggestionRepo.createQueryBuilder('s')
      .where('s.merged_into_id IS NULL')
      .andWhere('s.deleted_at IS NULL');

    // ─── Filters ──────────────────────────────────
    if (query.type) {
      qb.andWhere('s.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    if (query.search) {
      qb.andWhere('(s.title ILIKE :search OR s.description ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    // ─── Sorting ──────────────────────────────────
    qb.addOrderBy('s.is_pinned', 'DESC');

    switch (query.sort) {
      case 'recent':
        qb.addOrderBy('s.created_at', 'DESC');
        break;
      case 'most_commented':
        qb.addOrderBy('s.comments_count', 'DESC');
        qb.addOrderBy('s.created_at', 'DESC');
        break;
      case 'popular':
      default:
        qb.addOrderBy('s.likes_count', 'DESC');
        qb.addOrderBy('s.created_at', 'DESC');
        break;
    }

    qb.skip(offset).take(limit);

    const [items, total] = await qb.getManyAndCount();

    // ─── Enrich: check if currentUser liked/followed (batch query, no N+1) ──
    let likedIds: Set<string> = new Set();
    let followedIds: Set<string> = new Set();

    if (currentUserId && items.length > 0) {
      const ids = items.map((s) => s.id);

      const [likes, follows] = await Promise.all([
        this.likeRepo.find({
          where: { merchantId: currentUserId, suggestionId: In(ids) },
          select: ['suggestionId'],
        }),
        this.followerRepo.find({
          where: { merchantId: currentUserId, suggestionId: In(ids) },
          select: ['suggestionId'],
        }),
      ]);

      likedIds = new Set(likes.map((l) => l.suggestionId));
      followedIds = new Set(follows.map((f) => f.suggestionId));
    }

    const suggestions = items.map((s) => ({
      ...this.sanitizeForPublic(s),
      isLiked: likedIds.has(s.id),
      isFollowed: followedIds.has(s.id),
    }));

    return {
      suggestions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📋 LIST FOR ADMIN (shows real identity even for anonymous)
  // ═══════════════════════════════════════════════════════════════════════════

  async listForAdmin(query: ListSuggestionsQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    const qb = this.suggestionRepo.createQueryBuilder('s')
      .where('s.deleted_at IS NULL');

    if (query.type) {
      qb.andWhere('s.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    if (query.search) {
      qb.andWhere('(s.title ILIKE :search OR s.description ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.addOrderBy('s.is_pinned', 'DESC');
    qb.addOrderBy('s.created_at', 'DESC');
    qb.skip(offset).take(limit);

    const [items, total] = await qb.getManyAndCount();

    // ✅ Admin sees real identity — including anonymous
    const suggestions = items.map((s) => this.sanitizeForAdmin(s));

    return {
      suggestions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📄 GET SINGLE SUGGESTION (merchant facing)
  // ═══════════════════════════════════════════════════════════════════════════

  async findOne(id: string, currentUserId?: string) {
    const suggestion = await this.suggestionRepo.findOne({ where: { id } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');

    let isLiked = false;
    let isFollowed = false;

    if (currentUserId) {
      const [like, follow] = await Promise.all([
        this.likeRepo.findOne({
          where: { suggestionId: id, merchantId: currentUserId },
        }),
        this.followerRepo.findOne({
          where: { suggestionId: id, merchantId: currentUserId },
        }),
      ]);
      isLiked = !!like;
      isFollowed = !!follow;
    }

    return {
      ...this.sanitizeForPublic(suggestion),
      isLiked,
      isFollowed,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ➕ CREATE SUGGESTION
  // ═══════════════════════════════════════════════════════════════════════════

  async create(
    dto: CreateSuggestionDto,
    user: { id: string; tenantId: string; firstName?: string; lastName?: string; email?: string },
    tenantName?: string,
  ) {
    const merchantDisplayName = [user.firstName, user.lastName].filter(Boolean).join(' ')
      || user.email || null;

    const suggestion = this.suggestionRepo.create({
      title: dto.title.trim(),
      description: dto.description.trim(),
      type: dto.type,
      merchantId: user.id,
      tenantId: user.tenantId,
      merchantName: merchantDisplayName,
      storeName: tenantName || null,
      isAnonymous: dto.isAnonymous ?? false,
      status: SuggestionStatus.UNDER_REVIEW,
    });

    const saved = await this.suggestionRepo.save(suggestion);

    // Auto-follow own suggestion (safe against duplicate)
    try {
      await this.followerRepo.save(
        this.followerRepo.create({ suggestionId: saved.id, merchantId: user.id }),
      );
      await this.suggestionRepo.increment({ id: saved.id }, 'followersCount', 1);
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
    }

    this.logger.log(`Suggestion created: ${saved.id} by user ${user.id}`);

    return this.sanitizeForPublic(saved);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 👍 LIKE / UNLIKE — Race-condition safe
  // ═══════════════════════════════════════════════════════════════════════════

  async toggleLike(suggestionId: string, merchantId: string) {
    const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');

    const existing = await this.likeRepo.findOne({
      where: { suggestionId, merchantId },
    });

    if (existing) {
      await this.likeRepo.remove(existing);
      await this.suggestionRepo.decrement({ id: suggestionId }, 'likesCount', 1);
      // Ensure counter never negative
      await this.suggestionRepo
        .createQueryBuilder()
        .update(Suggestion)
        .set({ likesCount: () => 'GREATEST(likes_count, 0)' })
        .where('id = :id', { id: suggestionId })
        .execute();
      return { liked: false, likesCount: Math.max(0, suggestion.likesCount - 1) };
    }

    // Like — protected against UNIQUE violation from concurrent requests
    try {
      await this.likeRepo.save(
        this.likeRepo.create({ suggestionId, merchantId }),
      );
      await this.suggestionRepo.increment({ id: suggestionId }, 'likesCount', 1);
      return { liked: true, likesCount: suggestion.likesCount + 1 };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return { liked: true, likesCount: suggestion.likesCount };
      }
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔔 FOLLOW / UNFOLLOW — Race-condition safe
  // ═══════════════════════════════════════════════════════════════════════════

  async toggleFollow(suggestionId: string, merchantId: string) {
    const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');

    const existing = await this.followerRepo.findOne({
      where: { suggestionId, merchantId },
    });

    if (existing) {
      await this.followerRepo.remove(existing);
      await this.suggestionRepo.decrement({ id: suggestionId }, 'followersCount', 1);
      await this.suggestionRepo
        .createQueryBuilder()
        .update(Suggestion)
        .set({ followersCount: () => 'GREATEST(followers_count, 0)' })
        .where('id = :id', { id: suggestionId })
        .execute();
      return { followed: false };
    }

    try {
      await this.followerRepo.save(
        this.followerRepo.create({ suggestionId, merchantId }),
      );
      await this.suggestionRepo.increment({ id: suggestionId }, 'followersCount', 1);
      return { followed: true };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return { followed: true };
      }
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 💬 COMMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  async getComments(suggestionId: string, page = 1, limit = 30, revealIdentity = false) {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');
    const offset = (normalizedPage - 1) * normalizedLimit;

    const [items, total] = await this.commentRepo.findAndCount({
      where: { suggestionId },
      order: { createdAt: 'ASC' },
      skip: offset,
      take: normalizedLimit,
    });

    const comments = items.map((c) => this.sanitizeComment(c, revealIdentity));
    return {
      comments,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages: Math.ceil(total / normalizedLimit),
    };
  }

  async addComment(
    suggestionId: string,
    dto: CreateCommentDto,
    user: { id: string; firstName?: string; lastName?: string; email?: string },
    tenantName?: string,
  ) {
    const merchantDisplayName = [user.firstName, user.lastName].filter(Boolean).join(' ')
      || user.email || null;
    const { suggestion, saved } = await this.suggestionRepo.manager.transaction(async manager => {
      const suggestionRepo = manager.getRepository(Suggestion);
      const commentRepo = manager.getRepository(SuggestionComment);
      const suggestion = await suggestionRepo.findOne({
        where: { id: suggestionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!suggestion || suggestion.mergedIntoId) throw new NotFoundException('الاقتراح غير موجود');

      const saved = await commentRepo.save(commentRepo.create({
        suggestionId,
        merchantId: user.id,
        comment: dto.comment.trim(),
        isAdmin: false,
        isAnonymous: dto.isAnonymous ?? false,
        merchantName: merchantDisplayName,
        storeName: tenantName || null,
      }));
      await suggestionRepo.increment({ id: suggestionId }, 'commentsCount', 1);
      return { suggestion, saved };
    });

    this.eventEmitter.emit('suggestion.commented', {
      suggestionId,
      commentId: saved.id,
      commenterId: user.id,
      suggestionTitle: suggestion.title,
    });

    return this.sanitizeComment(saved);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ ADMIN: Official Reply
  // ═══════════════════════════════════════════════════════════════════════════

  async addAdminComment(
    suggestionId: string,
    dto: AdminCreateCommentDto,
    admin: { id: string; firstName?: string; lastName?: string },
  ) {
    const adminName = [admin.firstName, admin.lastName].filter(Boolean).join(' ') || 'فريق رفيق';
    const { suggestion, saved } = await this.suggestionRepo.manager.transaction(async manager => {
      const suggestionRepo = manager.getRepository(Suggestion);
      const commentRepo = manager.getRepository(SuggestionComment);
      const suggestion = await suggestionRepo.findOne({
        where: { id: suggestionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!suggestion || suggestion.mergedIntoId) throw new NotFoundException('الاقتراح غير موجود');

      const saved = await commentRepo.save(commentRepo.create({
        suggestionId,
        merchantId: null,
        comment: dto.comment.trim(),
        isAdmin: true,
        adminId: admin.id,
        adminName,
        isAnonymous: false,
      }));
      await suggestionRepo.increment({ id: suggestionId }, 'commentsCount', 1);
      await suggestionRepo.update(suggestionId, {
        hasAdminResponse: true,
        adminResponsePreview: dto.comment.trim().substring(0, 500),
      });
      return { suggestion, saved };
    });

    this.eventEmitter.emit('suggestion.admin_replied', {
      suggestionId,
      commentId: saved.id,
      suggestionTitle: suggestion.title,
    });

    return this.sanitizeComment(saved);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ ADMIN: Change Status
  // ═══════════════════════════════════════════════════════════════════════════

  async updateStatus(suggestionId: string, dto: UpdateSuggestionStatusDto) {
    const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');

    const oldStatus = suggestion.status;
    if (oldStatus === dto.status) return { id: suggestionId, status: dto.status };
    await this.suggestionRepo.update(suggestionId, { status: dto.status });

    this.eventEmitter.emit('suggestion.status_changed', {
      suggestionId,
      oldStatus,
      newStatus: dto.status,
      suggestionTitle: suggestion.title,
    });

    return { id: suggestionId, status: dto.status };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ ADMIN: Pin / Unpin
  // ═══════════════════════════════════════════════════════════════════════════

  async togglePin(suggestionId: string) {
    const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');

    const newPinned = !suggestion.isPinned;
    await this.suggestionRepo.update(suggestionId, { isPinned: newPinned });

    return { id: suggestionId, isPinned: newPinned };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ ADMIN: Merge Suggestions
  // ═══════════════════════════════════════════════════════════════════════════

  async merge(dto: MergeSuggestionsDto) {
    if (dto.sourceId === dto.targetId) throw new BadRequestException('لا يمكن دمج الاقتراح مع نفسه');
    const result = await this.suggestionRepo.manager.transaction(async manager => {
      const suggestionRepo = manager.getRepository(Suggestion);
      const likeRepo = manager.getRepository(SuggestionLike);
      const followerRepo = manager.getRepository(SuggestionFollower);
      const commentRepo = manager.getRepository(SuggestionComment);
      const lockedSuggestions: Suggestion[] = [];
      for (const id of [dto.sourceId, dto.targetId].sort()) {
        const suggestion = await suggestionRepo.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (suggestion) lockedSuggestions.push(suggestion);
      }
      const source = lockedSuggestions.find(suggestion => suggestion.id === dto.sourceId);
      const target = lockedSuggestions.find(suggestion => suggestion.id === dto.targetId);

      if (!source || !target) throw new NotFoundException('أحد الاقتراحات غير موجود');
      if (source.mergedIntoId || target.mergedIntoId) throw new BadRequestException('لا يمكن الدمج مع اقتراح مدمج');

      const sourceLikes = await likeRepo.find({ where: { suggestionId: dto.sourceId } });
      for (const like of sourceLikes) {
        try {
          await likeRepo.save(likeRepo.create({ suggestionId: dto.targetId, merchantId: like.merchantId }));
        } catch (error: unknown) {
          if (!isUniqueViolation(error)) throw error;
        }
      }

      const sourceFollowers = await followerRepo.find({ where: { suggestionId: dto.sourceId } });
      for (const follower of sourceFollowers) {
        try {
          await followerRepo.save(followerRepo.create({ suggestionId: dto.targetId, merchantId: follower.merchantId }));
        } catch (error: unknown) {
          if (!isUniqueViolation(error)) throw error;
        }
      }

      await commentRepo.update({ suggestionId: dto.sourceId }, { suggestionId: dto.targetId });
      const [newLikes, newFollowers] = await Promise.all([
        likeRepo.count({ where: { suggestionId: dto.targetId } }),
        followerRepo.count({ where: { suggestionId: dto.targetId } }),
      ]);
      const commentSummary = await this.getCommentSummary(dto.targetId, manager);
      await suggestionRepo.update(dto.targetId, {
        likesCount: newLikes,
        followersCount: newFollowers,
        ...commentSummary,
      });
      await suggestionRepo.update(dto.sourceId, { mergedIntoId: dto.targetId, commentsCount: 0 });
      return { newLikes, newFollowers, commentsCount: commentSummary.commentsCount };
    });

    this.logger.log(`Merged suggestion ${dto.sourceId} → ${dto.targetId}`);

    return {
      mergedSuggestionId: dto.sourceId,
      targetSuggestionId: dto.targetId,
      newLikesCount: result.newLikes,
      newFollowersCount: result.newFollowers,
      commentsCount: result.commentsCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛡️ ADMIN: Delete
  // ═══════════════════════════════════════════════════════════════════════════

  async deleteSuggestion(suggestionId: string) {
    const suggestion = await this.suggestionRepo.findOne({ where: { id: suggestionId } });
    if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');
    await this.suggestionRepo.softRemove(suggestion);
    return { deleted: true };
  }

  async deleteComment(commentId: string) {
    return this.suggestionRepo.manager.transaction(async manager => {
      const commentRepo = manager.getRepository(SuggestionComment);
      const suggestionRepo = manager.getRepository(Suggestion);
      const comment = await commentRepo.findOne({ where: { id: commentId } });
      if (!comment) throw new NotFoundException('التعليق غير موجود');
      const suggestion = await suggestionRepo.findOne({
        where: { id: comment.suggestionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!suggestion) throw new NotFoundException('الاقتراح غير موجود');
      await commentRepo.softRemove(comment);
      const summary = await this.getCommentSummary(comment.suggestionId, manager);
      await suggestionRepo.update(comment.suggestionId, summary);
      return { deleted: true, ...summary };
    });
  }

  private async getCommentSummary(suggestionId: string, manager: EntityManager) {
    const commentRepo = manager.getRepository(SuggestionComment);
    const [commentsCount, latestAdminComment] = await Promise.all([
      commentRepo.count({ where: { suggestionId } }),
      commentRepo.findOne({ where: { suggestionId, isAdmin: true }, order: { createdAt: 'DESC' } }),
    ]);
    return {
      commentsCount,
      hasAdminResponse: !!latestAdminComment,
      adminResponsePreview: latestAdminComment?.comment.substring(0, 500) ?? null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🗺️ ROADMAP (public)
  // ═══════════════════════════════════════════════════════════════════════════

  async getRoadmap() {
    const statuses = [
      SuggestionStatus.UNDER_STUDY,
      SuggestionStatus.IN_PROGRESS,
      SuggestionStatus.COMPLETED,
    ];

    const items = await this.suggestionRepo.find({
      where: { status: In(statuses), mergedIntoId: IsNull() },
      order: { likesCount: 'DESC', createdAt: 'DESC' },
      take: 100,
    });

    const roadmap: Record<string, Array<ReturnType<typeof this.sanitizeForPublic>>> = {
      under_study: [],
      in_progress: [],
      completed: [],
    };

    for (const item of items) {
      roadmap[item.status]?.push(this.sanitizeForPublic(item));
    }

    return roadmap;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 STATS (admin)
  // ═══════════════════════════════════════════════════════════════════════════

  async getStats() {
    const [total, underReview, inProgress, completed, rejected] = await Promise.all([
      this.suggestionRepo.count({ where: { mergedIntoId: IsNull() } }),
      this.suggestionRepo.count({ where: { status: SuggestionStatus.UNDER_REVIEW, mergedIntoId: IsNull() } }),
      this.suggestionRepo.count({ where: { status: SuggestionStatus.IN_PROGRESS, mergedIntoId: IsNull() } }),
      this.suggestionRepo.count({ where: { status: SuggestionStatus.COMPLETED, mergedIntoId: IsNull() } }),
      this.suggestionRepo.count({ where: { status: SuggestionStatus.REJECTED, mergedIntoId: IsNull() } }),
    ]);
    return { total, underReview, inProgress, completed, rejected };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 SANITIZERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 🔒 PUBLIC — hides identity if anonymous
   * ❌ NEVER returns merchantId or tenantId
   */
  private sanitizeForPublic(s: Suggestion) {
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      type: s.type,
      status: s.status,
      isPinned: s.isPinned,
      likesCount: s.likesCount,
      commentsCount: s.commentsCount,
      followersCount: s.followersCount,
      hasAdminResponse: s.hasAdminResponse,
      adminResponsePreview: s.adminResponsePreview,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      merchantName: s.isAnonymous ? null : s.merchantName,
      storeName: s.isAnonymous ? null : s.storeName,
      isAnonymous: s.isAnonymous,
    };
  }

  /**
   * 🛡️ ADMIN — always shows real identity + internal IDs
   */
  private sanitizeForAdmin(s: Suggestion) {
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      type: s.type,
      status: s.status,
      isPinned: s.isPinned,
      likesCount: s.likesCount,
      commentsCount: s.commentsCount,
      followersCount: s.followersCount,
      hasAdminResponse: s.hasAdminResponse,
      adminResponsePreview: s.adminResponsePreview,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      isAnonymous: s.isAnonymous,
      mergedIntoId: s.mergedIntoId,
      merchantId: s.merchantId,
      tenantId: s.tenantId,
      merchantName: s.merchantName,
      storeName: s.storeName,
    };
  }

  private sanitizeComment(c: SuggestionComment, revealIdentity = false) {
    return {
      id: c.id,
      suggestionId: c.suggestionId,
      comment: c.comment,
      isAdmin: c.isAdmin,
      adminName: c.isAdmin ? (c.adminName || 'فريق رفيق') : null,
      merchantName: c.isAnonymous && !revealIdentity ? null : c.merchantName,
      storeName: c.isAnonymous && !revealIdentity ? null : c.storeName,
      isAnonymous: c.isAnonymous,
      createdAt: c.createdAt,
    };
  }

  async getFollowerIds(suggestionId: string): Promise<string[]> {
    const followers = await this.followerRepo.find({
      where: { suggestionId },
      select: ['merchantId'],
    });
    return followers.map((f) => f.merchantId);
  }
}
