import { resolveSallaWebhookExpiry } from '../salla-oauth.service';

describe('resolveSallaWebhookExpiry', () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);

  it('uses an absolute Unix timestamp from Easy Mode without adding it to now', () => {
    const absoluteSeconds = Math.floor((now + 14 * 24 * 60 * 60 * 1000) / 1000);
    expect(resolveSallaWebhookExpiry(absoluteSeconds, now).getTime()).toBe(absoluteSeconds * 1000);
  });

  it('supports a relative duration defensively', () => {
    expect(resolveSallaWebhookExpiry(3600, now).getTime()).toBe(now + 3600 * 1000);
  });

  it('keeps an already-expired Unix timestamp expired so refresh can run', () => {
    const expiredSeconds = Math.floor((now - 60_000) / 1000);
    expect(resolveSallaWebhookExpiry(expiredSeconds, now).getTime()).toBe(expiredSeconds * 1000);
  });

  it('falls back to one hour for a missing value', () => {
    expect(resolveSallaWebhookExpiry(undefined, now).getTime()).toBe(now + 3600 * 1000);
  });
});
