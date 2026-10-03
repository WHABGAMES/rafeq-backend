import { PERMISSIONS } from '../entities/admin-user.entity';
import { PERMISSIONS_KEY, REQUIRE_2FA_KEY } from '../guards/admin.guards';
import { WhatsappController } from './admin.controllers';

describe('WhatsappController authorization metadata', () => {
  const metadata = (method: keyof WhatsappController, key: string) =>
    Reflect.getMetadata(key, WhatsappController.prototype[method]);

  it.each(['getSettings', 'connect', 'toggle', 'getMessages', 'test'] as const)(
    'requires WhatsApp management permission for %s',
    method => {
      expect(metadata(method, PERMISSIONS_KEY)).toEqual([PERMISSIONS.WHATSAPP_MANAGE]);
    },
  );

  it.each(['connect', 'toggle', 'test'] as const)(
    'does not require a second 2FA gate after authenticated admin login for %s',
    method => {
      expect(metadata(method, REQUIRE_2FA_KEY)).toBeUndefined();
    },
  );
});
