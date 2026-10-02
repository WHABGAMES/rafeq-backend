import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MessageChannel, MessageLanguage, TriggerEvent } from '../entities/message-template.entity';
import { CreateAdminTemplateDto, TestAdminTemplateDto } from './admin-template.dto';

describe('admin template DTOs', () => {
  it('accepts a valid email template', async () => {
    const dto = plainToInstance(CreateAdminTemplateDto, {
      name: 'Welcome email',
      triggerEvent: TriggerEvent.NEW_MERCHANT_REGISTERED,
      channel: MessageChannel.EMAIL,
      language: MessageLanguage.EN,
      content: 'Welcome {{merchant_name}}',
      subject: 'Welcome',
      isActive: false,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid enums and oversized content', async () => {
    const dto = plainToInstance(CreateAdminTemplateDto, {
      name: 'Invalid',
      triggerEvent: 'UNKNOWN',
      channel: 'sms',
      language: 'fr',
      content: 'x'.repeat(20_001),
    });

    expect(await validate(dto)).toHaveLength(4);
  });

  it('validates international phone and email recipients', async () => {
    const dto = plainToInstance(TestAdminTemplateDto, {
      templateId: '17ac4434-d2d9-40c1-a494-d19e370c85d7',
      recipientPhone: '0500000000',
      recipientEmail: 'not-an-email',
    });

    expect(await validate(dto)).toHaveLength(2);
  });
});
