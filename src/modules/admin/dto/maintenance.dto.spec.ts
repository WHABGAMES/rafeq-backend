import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckMaintenanceRouteDto, UpdateMaintenanceDto } from './maintenance.dto';

describe('Maintenance DTOs', () => {
  it('accepts a bounded dashboard route', async () => {
    const dto = plainToInstance(CheckMaintenanceRouteDto, { route: ' /dashboard/inbox/thread ' });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.route).toBe('/dashboard/inbox/thread');
  });

  it('rejects routes outside the merchant dashboard', async () => {
    const dto = plainToInstance(CheckMaintenanceRouteDto, { route: '/super-admin/security' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('trims custom messages before persistence', async () => {
    const dto = plainToInstance(UpdateMaintenanceDto, { message: '  صيانة قصيرة  ' });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.message).toBe('صيانة قصيرة');
  });
});
