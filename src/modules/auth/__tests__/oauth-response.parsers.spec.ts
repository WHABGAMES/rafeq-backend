import {
  parseGoogleIdentity,
  parseGoogleTokenResponse,
  parseSallaMerchant,
  parseSallaTokens,
  parseZidMerchant,
  parseZidTokens,
} from '../oauth-response.parsers';

describe('OAuth response parsers', () => {
  it('accepts a complete Google identity only for the configured client and trusted issuer', () => {
    expect(parseGoogleTokenResponse({ id_token: 'identity-token' })).toBe('identity-token');
    expect(parseGoogleIdentity({
      iss: 'https://accounts.google.com', aud: 'client-id', email_verified: true,
      email: 'merchant@example.com', sub: 'google-user', name: 'Merchant User',
    }, 'client-id')).toMatchObject({ email: 'merchant@example.com', sub: 'google-user' });
  });

  it('rejects malformed Google responses and unverified identities', () => {
    expect(() => parseGoogleTokenResponse({})).toThrow('id_token');
    expect(() => parseGoogleIdentity({
      iss: 'https://accounts.google.com', aud: 'client-id', email_verified: false,
      email: 'merchant@example.com', sub: 'google-user',
    }, 'client-id')).toThrow('not verified');
  });

  it('parses required Salla and Zid response fields while rejecting incomplete payloads', () => {
    expect(parseSallaTokens({ access_token: 'salla-token' })).toEqual({ access_token: 'salla-token' });
    expect(parseSallaMerchant({ data: { email: 'merchant@salla.test', id: 7 } }).data?.email)
      .toBe('merchant@salla.test');
    expect(parseZidTokens({ access_token: 'zid-access', refresh_token: 'zid-refresh' }))
      .toMatchObject({ access_token: 'zid-access', refresh_token: 'zid-refresh' });
    expect(parseZidMerchant({ user: { email: 'merchant@zid.test', store_id: 9 } }).user?.email)
      .toBe('merchant@zid.test');
    expect(() => parseSallaTokens({})).toThrow('access_token');
    expect(() => parseZidTokens({ access_token: 'missing-refresh' })).toThrow('refresh_token');
  });
});
