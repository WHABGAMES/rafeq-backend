import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { SystemHealthController } from './system-health.controller';

describe('SystemHealthController', () => {
  it('checks Redis through the shared application client and reports server metrics', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ ok: 1 }]),
    };
    const redisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      info: jest
        .fn()
        .mockResolvedValue('redis_version:7.2.4\r\nused_memory_human:12.5M\r\n'),
    };
    const controller = new SystemHealthController(
      dataSource as unknown as DataSource,
      redisClient as unknown as Redis,
    );

    const result = await controller.getSystemHealth();

    expect(result.overall).toBe('healthy');
    expect(result.services.redis).toEqual(
      expect.objectContaining({
        status: 'ok',
        version: '7.2.4',
        usedMemory: '12.5M',
      }),
    );
    expect(redisClient.ping).toHaveBeenCalledTimes(1);
    expect(redisClient.info).toHaveBeenCalledWith();
  });
});
