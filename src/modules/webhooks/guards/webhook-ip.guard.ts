/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║         RAFIQ PLATFORM — Webhook IP Allowlist Guard                            ║
 * ║                                                                                ║
 * ║  🔧 FIX H-06: Defense-in-depth — restrict webhook endpoints to known IPs      ║
 * ║                                                                                ║
 * ║  Even with HMAC signature verification, an IP allowlist prevents:              ║
 * ║  • Replay attacks if HMAC secret leaks                                        ║
 * ║  • Brute-force signature attempts                                             ║
 * ║  • Unauthorized probing of webhook endpoints                                  ║
 * ║                                                                                ║
 * ║  Usage:                                                                        ║
 * ║    @UseGuards(WebhookIpGuard)                                                 ║
 * ║    @Controller('webhooks/salla')                                               ║
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
import { Request } from 'express';
import * as net from 'net';

/**
 * Salla's known webhook source IPs (as of 2025)
 * Update these periodically from Salla's documentation.
 * Also accepts IPs from WEBHOOK_ALLOWED_IPS env variable.
 */
const SALLA_KNOWN_IPS: string[] = [
  // Salla production servers — update from Salla docs
  // These are CIDR ranges or individual IPs
];

const ZID_KNOWN_IPS: string[] = [
  // Zid production servers — update from Zid docs
];

@Injectable()
export class WebhookIpGuard implements CanActivate {
  private readonly logger = new Logger(WebhookIpGuard.name);
  private readonly allowedIps: Set<string>;
  private readonly allowedCidrs: string[];
  private readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const isProduction = configService.get('NODE_ENV') === 'production';

    // Load IPs from environment: comma-separated list
    const envIps = (configService.get<string>('WEBHOOK_ALLOWED_IPS') || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    // Combine hardcoded + environment IPs
    const allIps = [...SALLA_KNOWN_IPS, ...ZID_KNOWN_IPS, ...envIps];

    // Separate CIDRs from individual IPs
    this.allowedCidrs = allIps.filter((ip) => ip.includes('/'));
    this.allowedIps = new Set(allIps.filter((ip) => !ip.includes('/')));

    // Enable in production, configurable via env
    this.isEnabled =
      configService.get<string>('WEBHOOK_IP_ALLOWLIST_ENABLED') === 'true' || isProduction;

    if (this.isEnabled && allIps.length === 0) {
      this.logger.warn(
        '⚠️ WebhookIpGuard is ENABLED but no IPs configured! ' +
        'Set WEBHOOK_ALLOWED_IPS in environment variables. ' +
        'All webhook requests will be REJECTED until IPs are configured.',
      );
    } else if (this.isEnabled) {
      this.logger.log(
        `✅ WebhookIpGuard active: ${this.allowedIps.size} IPs + ${this.allowedCidrs.length} CIDRs`,
      );
    } else {
      this.logger.warn('⚠️ WebhookIpGuard is DISABLED (development mode)');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    // Skip in development/testing if not explicitly enabled
    if (!this.isEnabled) {
      return true;
    }

    // If no IPs configured, reject all (fail-closed)
    if (this.allowedIps.size === 0 && this.allowedCidrs.length === 0) {
      this.logger.error('⛔ No webhook IPs configured — rejecting all requests (fail-closed)');
      throw new ForbiddenException('Webhook source not authorized');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = this.getClientIp(request);

    if (!clientIp) {
      this.logger.warn('⛔ Could not determine client IP');
      throw new ForbiddenException('Webhook source not authorized');
    }

    // Check exact match
    if (this.allowedIps.has(clientIp)) {
      return true;
    }

    // Check CIDR ranges
    for (const cidr of this.allowedCidrs) {
      if (this.isIpInCidr(clientIp, cidr)) {
        return true;
      }
    }

    this.logger.warn(`⛔ Webhook rejected from unauthorized IP: ${clientIp}`);
    throw new ForbiddenException('Webhook source not authorized');
  }

  /**
   * Extract the real client IP, accounting for proxies
   */
  private getClientIp(req: Request): string | null {
    // Trust X-Forwarded-For only if behind a trusted proxy
    const trustProxy = this.configService.get('TRUST_PROXY') === 'true';

    if (trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        // First IP in chain is the original client
        return forwarded.split(',')[0].trim();
      }
      if (Array.isArray(forwarded) && forwarded.length > 0) {
        return forwarded[0].split(',')[0].trim();
      }
    }

    // req.ip already handles trust proxy if express is configured
    return req.ip || req.socket?.remoteAddress || null;
  }

  /**
   * Check if an IP is within a CIDR range
   */
  private isIpInCidr(ip: string, cidr: string): boolean {
    try {
      const [range, bits] = cidr.split('/');
      const mask = parseInt(bits, 10);

      if (!net.isIPv4(ip) || !net.isIPv4(range)) {
        return false;
      }

      const ipNum = this.ipToNumber(ip);
      const rangeNum = this.ipToNumber(range);
      const maskNum = ~(2 ** (32 - mask) - 1);

      return (ipNum & maskNum) === (rangeNum & maskNum);
    } catch {
      return false;
    }
  }

  private ipToNumber(ip: string): number {
    return ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  }
}
