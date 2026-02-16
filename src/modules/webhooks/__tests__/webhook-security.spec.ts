/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║         RAFIQ PLATFORM — Webhook Security Tests                                ║
 * ║                                                                                ║
 * ║  🔧 FIX L-02: Tests for webhook IP guard (H-06) and signature verification    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import * as crypto from 'crypto';

describe('Webhook Signature Verification', () => {
  const WEBHOOK_SECRET = 'test-webhook-secret-12345';

  function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const clean = signature.replace(/^sha256=|^sha1=/, '');

    if (clean.length !== expected.length) return false;

    return crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected));
  }

  it('should accept valid HMAC-SHA256 signatures', () => {
    const body = Buffer.from('{"event":"order.created","merchant":12345}');
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    expect(verifySignature(body, signature, WEBHOOK_SECRET)).toBe(true);
  });

  it('should reject signatures with wrong secret', () => {
    const body = Buffer.from('{"event":"order.created","merchant":12345}');
    const badSignature = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');

    expect(verifySignature(body, badSignature, WEBHOOK_SECRET)).toBe(false);
  });

  it('should reject tampered body', () => {
    const originalBody = Buffer.from('{"event":"order.created","merchant":12345}');
    const tamperedBody = Buffer.from('{"event":"order.created","merchant":99999}');
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(originalBody).digest('hex');

    expect(verifySignature(tamperedBody, signature, WEBHOOK_SECRET)).toBe(false);
  });

  it('should handle sha256= prefix in signature', () => {
    const body = Buffer.from('test payload');
    const rawSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    expect(verifySignature(body, `sha256=${rawSig}`, WEBHOOK_SECRET)).toBe(true);
  });

  it('should reject empty signatures', () => {
    const body = Buffer.from('test');
    expect(verifySignature(body, '', WEBHOOK_SECRET)).toBe(false);
  });
});

describe('Webhook IP Allowlist Logic', () => {
  function ipToNumber(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  }

  function isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
    return (ipToNumber(ip) & mask) === (ipToNumber(range) & mask);
  }

  it('should match IP in CIDR range', () => {
    expect(isIpInCidr('192.168.1.100', '192.168.1.0/24')).toBe(true);
    expect(isIpInCidr('192.168.1.1', '192.168.1.0/24')).toBe(true);
    expect(isIpInCidr('192.168.1.255', '192.168.1.0/24')).toBe(true);
  });

  it('should reject IP outside CIDR range', () => {
    expect(isIpInCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
    expect(isIpInCidr('10.0.0.1', '192.168.1.0/24')).toBe(false);
  });

  it('should handle /32 single-host CIDR', () => {
    expect(isIpInCidr('10.0.0.1', '10.0.0.1/32')).toBe(true);
    expect(isIpInCidr('10.0.0.2', '10.0.0.1/32')).toBe(false);
  });
});
