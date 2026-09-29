import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateOtpRelayConfigDto,
  VerifyOtpRequestDto,
} from '../otp-relay.dto';
import { OtpPlatform } from '../../entities/otp-config.entity';

describe('OTP relay DTOs', () => {
  it('accepts a valid tenant OTP configuration', async () => {
    const dto = plainToInstance(CreateOtpRelayConfigDto, {
      slug: 'steam-sa',
      platform: OtpPlatform.STEAM,
      emailPort: '993',
      emailTls: true,
      otpMethod: 'email',
      rateLimit: '3',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.emailPort).toBe(993);
    expect(dto.rateLimit).toBe(3);
  });

  it('rejects invalid public OTP requests and unsafe configuration values', async () => {
    const request = plainToInstance(VerifyOtpRequestDto, { orderNumber: '', username: '' });
    const config = plainToInstance(CreateOtpRelayConfigDto, {
      slug: 'x',
      platform: 'unknown-platform',
      emailPort: 70_000,
    });

    expect(await validate(request)).not.toHaveLength(0);
    expect(await validate(config)).not.toHaveLength(0);
  });
});
