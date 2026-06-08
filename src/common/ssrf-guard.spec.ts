import { assertHostAllowed, assertPublicUrl, isBlockedIp } from './ssrf-guard';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', // loopback
    '127.1.2.3', // loopback /8
    '0.0.0.0', // unspecified
    '10.0.0.1', // private
    '172.16.5.4', // private /12
    '172.31.255.255', // private /12 ขอบบน
    '192.168.1.1', // private
    '169.254.169.254', // cloud metadata (link-local)
    '100.64.0.1', // CGNAT
    '255.255.255.255', // broadcast
    '224.0.0.1', // multicast
    '::1', // v6 loopback
    '::', // v6 unspecified
    'fe80::1', // v6 link-local
    'fc00::1', // v6 ULA
    'fd12:3456::1', // v6 ULA
    'ff02::1', // v6 multicast
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:169.254.169.254', // v4-mapped metadata
  ])('block %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8', // public v4
    '1.1.1.1',
    '172.32.0.1', // นอกช่วง 172.16/12
    '169.253.0.1', // นอกช่วง link-local
    '93.184.216.34', // example.com
    '2606:2800:220:1:248:1893:25c8:1946', // public v6
    'example.com', // ไม่ใช่ IP literal → ปล่อยให้ lookup เช็คตอน resolve
  ])('allow %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('assertHostAllowed', () => {
  it.each(['127.0.0.1', '[::1]', 'localhost', 'db.localhost', '10.0.0.1'])(
    'โยน SSRF_BLOCKED ต่อ host ภายใน: %s',
    (host) => {
      expect(() => assertHostAllowed(host)).toThrow(/SSRF_BLOCKED/);
    },
  );

  it.each(['example.com', '8.8.8.8', 'sub.example.co.th'])(
    'ผ่านต่อ host สาธารณะ: %s',
    (host) => {
      expect(() => assertHostAllowed(host)).not.toThrow();
    },
  );

  it('host ว่าง → โยน', () => {
    expect(() => assertHostAllowed('')).toThrow(/SSRF_BLOCKED/);
  });
});

describe('assertPublicUrl', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:6379/',
    'https://10.0.0.5/admin',
    'http://localhost:3000/',
  ])('โยน SSRF_BLOCKED ต่อ URL ภายใน: %s', (url) => {
    expect(() => assertPublicUrl(url)).toThrow(/SSRF_BLOCKED/);
  });

  it.each(['https://example.com/', 'http://www.google.com/search?q=x'])(
    'ผ่านต่อ URL สาธารณะ: %s',
    (url) => {
      expect(() => assertPublicUrl(url)).not.toThrow();
    },
  );
});
