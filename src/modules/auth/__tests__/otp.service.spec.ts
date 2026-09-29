import { UnauthorizedException } from '@nestjs/common';
import { OtpChannel, OtpService } from '../otp.service';

describe('OtpService', () => {
  const redis = { eval: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('test-jwt-secret') };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('consumes a valid OTP through one atomic Redis operation', async () => {
    const service = new OtpService(config as never);
    Object.assign(service as object, { redis });
    redis.eval.mockResolvedValueOnce([
      4,
      JSON.stringify({
        otpHash: 'stored-hash',
        channel: OtpChannel.EMAIL,
        attempts: 1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 300_000,
        email: 'user@example.com',
      }),
    ]);

    await expect(service.verifyOtp('user@example.com', '123456', OtpChannel.EMAIL)).resolves.toMatchObject({
      valid: true,
      email: 'user@example.com',
    });
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('rejects a verification once the atomic operation reports a consumed OTP', async () => {
    const service = new OtpService(config as never);
    Object.assign(service as object, { redis });
    redis.eval.mockResolvedValueOnce([0]);

    await expect(service.verifyOtp('user@example.com', '123456', OtpChannel.EMAIL))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
