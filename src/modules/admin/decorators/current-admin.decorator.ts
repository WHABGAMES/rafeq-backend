import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminUser } from '../entities/admin-user.entity';

export const CurrentAdmin = createParamDecorator(
  (data: keyof AdminUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const admin = request.admin as AdminUser;
    return data ? admin?.[data] : admin;
  },
);

export const AdminIp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const forwarded = request.headers?.['x-forwarded-for'];
    return request.ipAddress
      || (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim())
      || request.headers?.['x-real-ip']
      || request.ip
      || 'unknown';
  },
);
