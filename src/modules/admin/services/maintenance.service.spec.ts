import { MaintenancePage, MaintenanceStyle } from '../entities/maintenance-page.entity';
import { AdminUser } from '../entities/admin-user.entity';
import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService', () => {
  const actor = { id: 'admin-1', email: 'admin@example.com', role: 'super_admin' } as unknown as AdminUser;
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };

  const page = (overrides: Partial<MaintenancePage>): MaintenancePage => ({
    id: 'page-1',
    route: '/dashboard/inbox',
    label: 'المحادثات',
    isActive: false,
    style: MaintenanceStyle.OVERLAY,
    message: null,
    activatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createService = (pages: MaintenancePage[]) => {
    const repo = {
      find: jest.fn().mockResolvedValue(pages),
      findOneBy: jest.fn(),
      save: jest.fn(async (value: MaintenancePage) => value),
      create: jest.fn((value: MaintenancePage) => value),
    };
    return {
      service: new MaintenanceService(repo as never, auditService as never),
      repo,
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it('matches active nested routes using the most specific configured route', async () => {
    const parent = page({ id: 'parent', route: '/dashboard/inbox', isActive: true, style: MaintenanceStyle.BLUR });
    const child = page({ id: 'child', route: '/dashboard/inbox/settings', isActive: true, style: MaintenanceStyle.FULL_LOCK });
    const { service } = createService([parent, child]);

    await expect(service.checkRoute('/dashboard/inbox/settings/profile?tab=security')).resolves.toEqual(
      expect.objectContaining({ isActive: true, style: MaintenanceStyle.FULL_LOCK }),
    );
  });

  it('treats /dashboard as the home page only, not a global dashboard lock', async () => {
    const { service } = createService([
      page({ route: '/dashboard', isActive: true, style: MaintenanceStyle.FULL_LOCK }),
    ]);

    await expect(service.checkRoute('/dashboard')).resolves.toEqual(
      expect.objectContaining({ isActive: true }),
    );
    await expect(service.checkRoute('/dashboard/stores')).resolves.toEqual(
      expect.objectContaining({ isActive: false }),
    );
  });

  it('writes an immutable audit record when maintenance is enabled', async () => {
    const target = page({ isActive: false });
    const { service, repo } = createService([target]);
    repo.findOneBy.mockResolvedValue(target);

    await service.toggle(target.id, true, actor);

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: true, activatedBy: actor.email }));
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      action: 'maintenance.enabled',
      targetType: 'maintenance_page',
      targetId: target.id,
    }));
  });

  it('does not relabel a style-only edit as a new activation', async () => {
    const target = page({ isActive: true, activatedBy: 'first-admin@example.com' });
    const { service, repo } = createService([target]);
    repo.findOneBy.mockResolvedValue(target);

    const updated = await service.update(target.id, { style: MaintenanceStyle.BLUR }, actor);

    expect(updated.activatedBy).toBe('first-admin@example.com');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.updated' }));
  });
});
