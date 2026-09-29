import { lookup as lookupCallback } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, LookupFunction } from 'node:net';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookupCallback(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    const resolved = Array.isArray(addresses) ? addresses : [addresses];
    if (!resolved.length || resolved.some(({ address }) => isPrivateIpAddress(address))) {
      const blockedError = new Error('Hostname resolved to a private or invalid address');
      return callback(blockedError, '', 0);
    }

    if (options.all) return callback(null, resolved);
    return callback(null, resolved[0].address, resolved[0].family);
  });
};

export const publicHttpAgent = new HttpAgent({ lookup: publicLookup });
export const publicHttpsAgent = new HttpsAgent({ lookup: publicLookup });

export function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');

  if (isIP(normalized) === 4) {
    const [first, second] = normalized.split('.').map(Number);
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || first >= 224;
  }

  if (isIP(address) === 6) {
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized);
  }

  return true;
}

export async function assertPublicHttpUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    throw new Error('Private hostnames are not allowed');
  }

  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) throw new Error('Private IP addresses are not allowed');
    return url;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIpAddress(address))) {
    throw new Error('Hostname resolves to a private or invalid address');
  }

  return url;
}

export async function assertPublicHttpsUrl(value: string): Promise<URL> {
  const url = await assertPublicHttpUrl(value);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
  return url;
}
