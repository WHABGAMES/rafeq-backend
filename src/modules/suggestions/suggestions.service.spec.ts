import { Suggestion } from './entities/suggestion.entity';
import { SuggestionComment } from './entities/suggestion-comment.entity';
import { SuggestionFollower } from './entities/suggestion-follower.entity';
import { SuggestionLike } from './entities/suggestion-like.entity';
import { SuggestionsService } from './suggestions.service';

describe('SuggestionsService comment integrity', () => {
  it('rebuilds counters and admin response state atomically after deleting a comment', async () => {
    const commentRepo = {
      findOne: jest.fn()
        .mockResolvedValueOnce({ id: 'comment-1', suggestionId: 'suggestion-1' })
        .mockResolvedValueOnce(null),
      softRemove: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(2),
    };
    const suggestionRepoInTransaction = {
      findOne: jest.fn().mockResolvedValue({ id: 'suggestion-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => entity === SuggestionComment ? commentRepo : suggestionRepoInTransaction),
    };
    const suggestionRepo = {
      manager: { transaction: jest.fn((callback: (value: typeof manager) => unknown) => callback(manager)) },
    };
    const service = new SuggestionsService(
      suggestionRepo as never,
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
    );

    await expect(service.deleteComment('comment-1')).resolves.toEqual({
      deleted: true,
      commentsCount: 2,
      hasAdminResponse: false,
      adminResponsePreview: null,
    });
    expect(suggestionRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(suggestionRepoInTransaction.update).toHaveBeenCalledWith('suggestion-1', {
      commentsCount: 2,
      hasAdminResponse: false,
      adminResponsePreview: null,
    });
  });

  it('moves comments and rebuilds target counters inside the merge transaction', async () => {
    const suggestionRepoInTransaction = {
      findOne: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, mergedIntoId: null })),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const likeRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
    };
    const followerRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(4),
    };
    const commentRepo = {
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(5),
      findOne: jest.fn().mockResolvedValue({ comment: 'آخر رد رسمي' }),
    };
    const repositories = new Map<unknown, unknown>([
      [Suggestion, suggestionRepoInTransaction],
      [SuggestionLike, likeRepo],
      [SuggestionFollower, followerRepo],
      [SuggestionComment, commentRepo],
    ]);
    const manager = { getRepository: jest.fn((entity: unknown) => repositories.get(entity)) };
    const suggestionRepo = {
      manager: { transaction: jest.fn((callback: (value: typeof manager) => unknown) => callback(manager)) },
    };
    const service = new SuggestionsService(
      suggestionRepo as never,
      {} as never,
      {} as never,
      {} as never,
      { emit: jest.fn() } as never,
    );

    await expect(service.merge({ sourceId: 'source', targetId: 'target' })).resolves.toMatchObject({
      newLikesCount: 3,
      newFollowersCount: 4,
      commentsCount: 5,
    });
    expect(commentRepo.update).toHaveBeenCalledWith(
      { suggestionId: 'source' },
      { suggestionId: 'target' },
    );
    expect(suggestionRepoInTransaction.update).toHaveBeenCalledWith('target', expect.objectContaining({
      commentsCount: 5,
      hasAdminResponse: true,
      adminResponsePreview: 'آخر رد رسمي',
    }));
  });
});
