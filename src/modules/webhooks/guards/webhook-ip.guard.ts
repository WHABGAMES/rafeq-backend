/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║         RAFIQ PLATFORM — Webhook IP Allowlist Guard                            ║
 * ║                                                                                ║
 * ║  ✅ v2: FIX CRITICAL BUG — explicit false now overrides production mode       ║
 * ║                                                                                ║
 * ║  🐛 البق السابق:                                                               ║
 * ║     isEnabled = ('false' === 'true') || isProduction                          ║
 * ║     = false || true = TRUE  ← يتجاهل الـ false تماماً في production!          ║
 * ║                                                                                ║
 * ║  ✅ الإصلاح:                                                                   ║
 * ║     WEBHOOK_IP_ALLOWLIST_ENABLED=false → يُعطَّل دائماً بغض النظر عن البيئة  ║
 * ║     WEBHOOK_IP_ALLOWLIST_ENABLED=true  → يُفعَّل دائماً                       ║
 * ║     غير محدد + production              → يُفعَّل تلقائياً                     ║
 * ║     غير محدد + development             → يُعطَّل                              ║
 * ║                                                                                ║
 * ║  📋 الإعداد في .env:                                                           ║
 * ║     WEBHOOK_ALLOWED_IPS=18.157.170.48,18.158.0.0/16,3.120.0.0/14             ║
 * ║     WEBHOOK_IP_ALLOWLIST_ENABLED=false  ← يُعطِّل حتى في production           ║
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
 * Salla's known webhook source IPs
 * مأخوذة من لوقات الإنتاج + AWS eu-central-1 (Frankfurt)
 */
const SALLA_KNOWN_IPS: string[] = [
  // ✅ Confirmed from production logs (Feb 2026)
  '18.157.170.48',
  '18.157.156.218',

  // Salla uses AWS eu-central-1 (Frankfurt)
  '18.156.0.0/14',
  '3.120.0.0/14',
  '35.156.0.0/14',
  '52.57.0.0/16',
];

const ZID_KNOWN_IPS: string[] = [
  '108.128.244.94',
];

@Injectable()
export class WebhookIpGuard implements CanActivate {
  private readonly logger = new Logger(WebhookIpGuard.name);
  private readonly allowedIps: Set<string>;
  private readonly allowedCidrs: string[];
  private readonly isEnabled: boolean;

  constructor(configService: ConfigService) {
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

    // ✅ FIX CRITICAL: explicit false MUST override production mode
    //
    // Bug السابق:
    //   isEnabled = (envValue === 'true') || isProduction
    //   إذا envValue='false' و isProduction=true:
    //   = false || true = TRUE ← يتجاهل الـ false!
    //
    // الإصلاح: نفحص explicit false أولاً قبل أي شيء
    const envValue = configService.get<string>('WEBHOOK_IP_ALLOWLIST_ENABLED');
    const explicitlyDisabled = envValue === 'false';
    const explicitlyEnabled  = envValue === 'true';

    if (explicitlyDisabled) {
      // false صريح → معطَّل حتى في production
      this.isEnabled = false;
    } else if (explicitlyEnabled) {
      // true صريح → مفعَّل دائماً
      this.isEnabled = true;
    } else {
      // غير محدد → يعتمد على البيئة (production=true, dev=false)
      this.isEnabled = isProduction;
    }

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
      this.logger.warn(
        `⚠️ WebhookIpGuard is DISABLED (WEBHOOK_IP_ALLOWLIST_ENABLED=false) — ` +
        `all IPs allowed. Set to 'true' or remove to re-enable in production.`,
      );
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

    // Debug: log both detected and raw IPs
    const rawIp = request.socket?.remoteAddress;
    if (rawIp && rawIp !== clientIp) {
      this.logger.debug(`IP resolved: ${clientIp} (proxy: ${rawIp})`);
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
   * Extract the real client IP, accounting for Cloudflare and other proxies
   * 
   * 🐛 FIX: التطبيق خلف Cloudflare → req.socket.remoteAddress يرجع IP Cloudflare
   *    مثلاً 172.70.240.45 بدل 18.157.170.48 (سلة)
   *    الحل: نقرأ CF-Connecting-IP (أموثق header من Cloudflare)
   */
  private getClientIp(req: Request): string | null {
    // 1️⃣ Cloudflare: CF-Connecting-IP هو أدق header (لا يقبل التلاعب)
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    // 2️⃣ X-Real-IP (يُستخدم من nginx/proxies أخرى)
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
      return realIp.trim();
    }

    // 3️⃣ X-Forwarded-For (أول IP = العميل الأصلي)
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return forwarded[0].split(',')[0].trim();
    }

    // 4️⃣ Fallback: Express req.ip أو socket
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
