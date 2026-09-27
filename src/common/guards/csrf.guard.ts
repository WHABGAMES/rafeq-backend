/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║         RAFIQ PLATFORM — CSRF Protection Guard                                 ║
 * ║                                                                                ║
 * ║  🔧 FIX S-01: CSRF protection for cookie-authenticated endpoints             ║
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

  /**
   * Bearer-authenticated API calls are not susceptible to browser CSRF because an
   * attacker cannot attach the Authorization header cross-origin. These routes,
   * however, authenticate with an httpOnly refresh cookie and must therefore use
   * a double-submit token. Keeping the scope explicit avoids breaking provider
   * callbacks and server-to-server webhooks from Salla and Zid.
   */
  private static readonly COOKIE_AUTHENTICATED_PATHS = new Set([
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/admin/auth/refresh',
    '/api/admin/auth/logout',
  ]);

  private static readonly SESSION_COOKIES = ['rafeq_rt', 'rafeq_admin_rt'] as const;

  constructor(private configService: ConfigService) {
    this.isEnabled = this.configService.get('NODE_ENV') === 'production';
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.isEnabled) {
      return true; // Skip in development
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    // Only check state-changing methods.
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const path = request.path || request.originalUrl?.split('?')[0] || '';
    const hasSessionCookie = CsrfGuard.SESSION_COOKIES.some(
      name => Boolean(request.cookies?.[name]),
    );

    // Apply globally, but only where an httpOnly session cookie is actually used.
    // This deliberately excludes OAuth callbacks and signed webhooks: they use
    // their own state/signature verification and do not authenticate via cookies.
    if (!hasSessionCookie || !CsrfGuard.COOKIE_AUTHENTICATED_PATHS.has(path)) {
      return true;
    }

    const cookieToken = request.cookies?.['csrf-token'];
    const rawHeaderToken = request.headers['x-csrf-token'];
    const headerToken = Array.isArray(rawHeaderToken)
      ? rawHeaderToken[0]
      : rawHeaderToken;

    if (!cookieToken || !headerToken) {
      this.logger.warn(`CSRF validation failed: missing tokens (path: ${path})`);
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
      this.logger.warn(`CSRF validation failed: token mismatch (path: ${path})`);
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
  const cookieDomain = configService.get<string>('CSRF_COOKIE_DOMAIN')
    || (isProduction ? '.rafeq.ai' : undefined);

  return (req: Request, res: Response, next: () => void) => {
    // Only set if not already present
    if (!req.cookies?.['csrf-token']) {
      const token = crypto.randomBytes(32).toString('hex');

      res.cookie('csrf-token', token, {
        httpOnly: false, // Client JS needs to read this
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }

    next();
  };
}
