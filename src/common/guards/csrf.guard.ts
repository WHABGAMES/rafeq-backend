/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║         RAFIQ PLATFORM — CSRF Protection Guard                                 ║
 * ║                                                                                ║
 * ║  🔧 FIX M-01: CSRF protection for state-changing auth endpoints               ║
 * ║                                                                                ║
 * ║  Strategy: Double Submit Cookie                                               ║
 * ║  - Server sets a random CSRF token in a cookie (non-httpOnly, SameSite=Strict)║
 * ║  - Client reads the cookie and sends it in X-CSRF-Token header                ║
 * ║  - Server verifies they match                                                 ║
 * ║                                                                                ║
 * ║  This works because:                                                          ║
 * ║  - Attacker sites cannot read cookies from another domain (SOP)               ║
 * ║  - Attacker sites cannot set custom headers on cross-origin requests          ║
 * ║                                                                                ║
 * ║  Usage:                                                                        ║
 * ║    @UseGuards(CsrfGuard)                                                      ║
 * ║    @Post('change-password')                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly isEnabled: boolean;

  constructor(private configService: ConfigService) {
    this.isEnabled = this.configService.get('NODE_ENV') === 'production';
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.isEnabled) {
      return true; // Skip in development
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Only check state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const cookieToken = request.cookies?.['csrf-token'];
    const headerToken = request.headers['x-csrf-token'] as string;

    if (!cookieToken || !headerToken) {
      this.logger.warn(`CSRF validation failed: missing tokens (path: ${request.path})`);
      throw new ForbiddenException('CSRF token missing');
    }

    // Timing-safe comparison
    if (cookieToken.length !== headerToken.length) {
      throw new ForbiddenException('CSRF token invalid');
    }

    const valid = crypto.timingSafeEqual(
      Buffer.from(cookieToken),
      Buffer.from(headerToken),
    );

    if (!valid) {
      this.logger.warn(`CSRF validation failed: token mismatch (path: ${request.path})`);
      throw new ForbiddenException('CSRF token invalid');
    }

    return true;
  }
}

/**
 * Middleware to set the CSRF cookie on every response
 * Apply in main.ts: app.use(csrfCookieMiddleware(configService));
 */
export function csrfCookieMiddleware(configService: ConfigService) {
  const isProduction = configService.get('NODE_ENV') === 'production';

  return (req: Request, res: Response, next: () => void) => {
    // Only set if not already present
    if (!req.cookies?.['csrf-token']) {
      const token = crypto.randomBytes(32).toString('hex');

      res.cookie('csrf-token', token, {
        httpOnly: false, // Client JS needs to read this
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }

    next();
  };
}
