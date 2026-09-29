import {
  jwtDurationToSeconds,
  normalizeJwtDuration,
} from '@common/utils/jwt-expiration.util';

describe('JWT expiration configuration', () => {
  it('accepts explicit duration values supported by the service', () => {
    expect(normalizeJwtDuration('15m', '7d')).toBe('15m');
    expect(normalizeJwtDuration(' 30s ', '7d')).toBe('30s');
  });

  it('falls back safely when configuration is malformed or missing', () => {
    expect(normalizeJwtDuration(undefined, '15m')).toBe('15m');
    expect(normalizeJwtDuration('tomorrow', '15m')).toBe('15m');
    expect(normalizeJwtDuration('15', '15m')).toBe('15m');
  });

  it('converts validated durations consistently for access-token policy checks', () => {
    expect(jwtDurationToSeconds('30s')).toBe(30);
    expect(jwtDurationToSeconds('15m')).toBe(900);
    expect(jwtDurationToSeconds('1h')).toBe(3600);
    expect(jwtDurationToSeconds('1d')).toBe(86400);
  });
});
