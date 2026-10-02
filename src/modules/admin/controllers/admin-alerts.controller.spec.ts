import { PERMISSIONS } from '../entities/admin-user.entity';
import { PERMISSIONS_KEY, REQUIRE_2FA_KEY } from '../guards/admin.guards';
import { AdminAlertsController } from './admin-alerts.controller';

describe('AdminAlertsController authorization metadata', () => {
  const metadata = (method: keyof AdminAlertsController, key: string) =>
    Reflect.getMetadata(key, AdminAlertsController.prototype[method]);

  it.each(['getAvailableEvents', 'listRecipients', 'getRecipient'] as const)(
    'requires alert read permission for %s',
    method => expect(metadata(method, PERMISSIONS_KEY)).toEqual([PERMISSIONS.ADMIN_ALERTS_READ]),
  );

  it.each(['createRecipient', 'updateRecipient', 'deleteRecipient', 'toggleRecipient'] as const)(
    'requires alert manage permission and 2FA for %s',
    method => {
      expect(metadata(method, PERMISSIONS_KEY)).toEqual([PERMISSIONS.ADMIN_ALERTS_MANAGE]);
      expect(metadata(method, REQUIRE_2FA_KEY)).toBe(true);
    },
  );

  it('requires dedicated test permission and 2FA for outbound test messages', () => {
    expect(metadata('sendTestAlert', PERMISSIONS_KEY)).toEqual([PERMISSIONS.ADMIN_ALERTS_TEST]);
    expect(metadata('sendTestAlert', REQUIRE_2FA_KEY)).toBe(true);
  });
});
