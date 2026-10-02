import { validate } from 'class-validator';
import { SaveAdminWhatsappSettingsDto } from './admin-whatsapp.dto';
import { WhatsappProvider } from '../entities/whatsapp-settings.entity';

describe('SaveAdminWhatsappSettingsDto', () => {
  it('allows an omitted token when updating existing settings', async () => {
    const dto = Object.assign(new SaveAdminWhatsappSettingsDto(), {
      phoneNumber: '+966500000000',
      provider: WhatsappProvider.META,
      phoneNumberId: '123456789',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported phone formats', async () => {
    const dto = Object.assign(new SaveAdminWhatsappSettingsDto(), {
      phoneNumber: '0500000000',
      provider: WhatsappProvider.META,
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'phoneNumber')).toBe(true);
  });
});
