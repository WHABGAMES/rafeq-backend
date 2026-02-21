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
    return ctx.switchToHttp().getRequest().ipAddress || 'unknown';
  },
);
