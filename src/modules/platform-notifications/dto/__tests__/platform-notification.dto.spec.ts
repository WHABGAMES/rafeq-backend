import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePlatformNotificationDto,
  UpdatePlatformNotificationDto,
} from '../platform-notification.dto';
import {
  PlatformNotificationDisplay,
  PlatformNotificationType,
} from '../../platform-notification.entity';

describe('Platform notification DTOs', () => {
  it('accepts a complete, valid creation request', async () => {
    const dto = plainToInstance(CreatePlatformNotificationDto, {
      type: PlatformNotificationType.ALERT,
      displayType: PlatformNotificationDisplay.POPUP,
      message: 'تحديث مهم',
      targetPlans: ['free'],
      startsAt: '2026-09-28T12:00:00.000Z',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.startsAt).toBeInstanceOf(Date);
  });

  it('rejects invalid enum values and a missing message', async () => {
    const dto = plainToInstance(CreatePlatformNotificationDto, {
      displayType: 'invalid',
      message: '',
    });

    const errors = await validate(dto);
    expect(errors.map(error => error.property)).toEqual(
      expect.arrayContaining(['displayType', 'message']),
    );
  });

  it('allows a partial update without requiring creation fields', async () => {
    const dto = plainToInstance(UpdatePlatformNotificationDto, { isActive: false });
    expect(await validate(dto)).toHaveLength(0);
  });
});
