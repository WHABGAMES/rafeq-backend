import {
  assertPublicHttpUrl,
  assertPublicHttpsUrl,
  isPrivateIpAddress,
} from '@common/utils/public-url.util';

describe('public URL security', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
  ])('blocks private address %s', (address) => {
    expect(isPrivateIpAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])(
    'allows public address %s',
    (address) => expect(isPrivateIpAddress(address)).toBe(false),
  );

  it('rejects local URLs before any request is made', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/admin')).rejects.toThrow('Private IP');
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow('HTTP and HTTPS');
  });

  it('requires HTTPS when a request carries credentials', async () => {
    await expect(assertPublicHttpsUrl('http://8.8.8.8/api')).rejects.toThrow('Only HTTPS');
    await expect(assertPublicHttpsUrl('https://8.8.8.8/api')).resolves.toMatchObject({
      protocol: 'https:',
    });
  });
});
