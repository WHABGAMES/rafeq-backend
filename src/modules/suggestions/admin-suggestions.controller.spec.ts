import { PERMISSIONS } from '@modules/admin/entities/admin-user.entity';
import { PERMISSIONS_KEY, REQUIRE_2FA_KEY } from '@modules/admin/guards/admin.guards';
import { AdminSuggestionsController } from './admin-suggestions.controller';

describe('AdminSuggestionsController authorization metadata', () => {
  const metadata = (method: keyof AdminSuggestionsController, key: string) =>
    Reflect.getMetadata(key, AdminSuggestionsController.prototype[method]);

  it.each(['getStats', 'list', 'getComments'] as const)(
    'requires read permission for %s',
    method => {
      expect(metadata(method, PERMISSIONS_KEY)).toEqual([PERMISSIONS.SUGGESTIONS_READ]);
    },
  );

  it.each(['updateStatus', 'togglePin', 'reply', 'merge', 'deleteComment', 'deleteSuggestion'] as const)(
    'requires manage permission for %s',
    method => {
      expect(metadata(method, PERMISSIONS_KEY)).toEqual([PERMISSIONS.SUGGESTIONS_MANAGE]);
    },
  );

  it.each(['merge', 'deleteComment', 'deleteSuggestion'] as const)(
    'requires verified 2FA for destructive operation %s',
    method => {
      expect(metadata(method, REQUIRE_2FA_KEY)).toBe(true);
    },
  );
});
