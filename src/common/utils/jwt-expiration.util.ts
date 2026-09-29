import type { JwtSignOptions } from '@nestjs/jwt';

/**
 * A duration accepted by jsonwebtoken/Nest when creating a JWT.
 * Keep this type coupled to Nest's public contract rather than treating env input
 * as an arbitrary string.
 */
export type JwtDuration = Exclude<NonNullable<JwtSignOptions['expiresIn']>, number>;

const JWT_DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

/**
 * Accept only explicit, unit-qualified JWT durations from configuration.
 * Invalid values use the caller's documented safe default.
 */
export function normalizeJwtDuration(value: unknown, fallback: JwtDuration): JwtDuration {
  if (typeof value !== 'string') {
    return fallback;
  }

  const duration = value.trim();
  return JWT_DURATION_PATTERN.test(duration) ? (duration as JwtDuration) : fallback;
}

export function jwtDurationToSeconds(duration: JwtDuration): number {
  const match = JWT_DURATION_PATTERN.exec(duration);
  if (!match) {
    throw new Error(`Invalid JWT duration: ${duration}`);
  }

  const amount = Number.parseInt(match[1], 10);
  const unitInSeconds: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * unitInSeconds[match[2]];
}
