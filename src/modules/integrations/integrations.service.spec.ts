import { ServiceUnavailableException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService legacy OAuth safety', () => {
  let service: IntegrationsService;

  beforeEach(() => {
    service = new IntegrationsService();
  });

  it.each([
    ['Salla', () => service.getSallaAuthUrl('tenant-1')],
    ['Zid', () => service.getZidAuthUrl('tenant-1')],
  ])('fails closed for the legacy %s authorization route', async (_platform, execute) => {
    await expect(execute()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    ['Salla', () => service.handleSallaCallback('fake-code', 'unsigned-state')],
    ['Zid', () => service.handleZidCallback('fake-code', 'unsigned-state')],
  ])('never creates a fake %s integration from the legacy callback', async (_platform, execute) => {
    await expect(execute()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.getActiveIntegrations('tenant-1')).resolves.toEqual({
      integrations: [],
      count: 0,
    });
  });
});
