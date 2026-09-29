import { parseSallaStoreData } from '../salla-oauth.service';
import { parseZidStoreProfile } from '../zid-api.service';
import { extractAuthorizationToken } from '../zid-oauth.service';

describe('store integration response parsers', () => {
  describe('parseSallaStoreData', () => {
    it('accepts the documented store envelope and keeps only supported fields', () => {
      expect(parseSallaStoreData({
        data: {
          id: 123,
          name: 'Store',
          username: 'store-user',
          email: 'store@example.com',
          mobile: '500000000',
          domain: 'store.example',
          plan: 'pro',
          avatar: 'https://cdn.example/avatar.png',
          ignored: 'value',
        },
      })).toEqual({
        id: 123,
        name: 'Store',
        username: 'store-user',
        email: 'store@example.com',
        mobile: '500000000',
        domain: 'store.example',
        plan: 'pro',
        avatar: 'https://cdn.example/avatar.png',
      });
    });

    it('rejects a malformed response before creating a store', () => {
      expect(() => parseSallaStoreData({ data: { name: 'Missing id' } })).toThrow(
        'missing id or name',
      );
    });
  });

  describe('parseZidStoreProfile', () => {
    it('normalizes the nested Zid profile and object currency/language fields', () => {
      expect(parseZidStoreProfile({
        user: {
          email: 'owner@example.com',
          mobile: '511111111',
          store: {
            id: 456,
            uuid: 'store-uuid',
            store_name: 'Zid Store',
            domain: 'zid.example',
            currency: { code: 'SAR' },
            language: { code: 'ar' },
          },
        },
      })).toEqual({
        id: '456',
        uuid: 'store-uuid',
        name: 'Zid Store',
        email: 'owner@example.com',
        mobile: '511111111',
        url: 'zid.example',
        logo: undefined,
        currency: 'SAR',
        language: 'ar',
      });
    });

    it('rejects non-object profiles instead of reading arbitrary values', () => {
      expect(() => parseZidStoreProfile('invalid')).toThrow('response is invalid');
    });
  });

  describe('extractAuthorizationToken', () => {
    it.each([
      { authorization: 'root-token' },
      { data: { authorization: 'data-token' } },
      { user: { authorization: 'user-token' } },
      { user: { store: { authorization: 'store-token' } } },
      { manager: { authorization: 'manager-token' } },
    ])('reads a supported Zid authorization path', (payload) => {
      expect(extractAuthorizationToken(payload)).toMatch(/-token$/);
    });

    it('does not coerce malformed tokens', () => {
      expect(extractAuthorizationToken({ authorization: 123 })).toBeUndefined();
    });
  });
});
