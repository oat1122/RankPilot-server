import { normalizeUrl, urlHash, urlHashOrNull } from './url';

describe('normalizeUrl', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['example.com:8080', 'https://example.com:8080/'], // bare domain + port ≠ scheme
    ['  https://x.com/a  ', 'https://x.com/a'], // trim
    ['http://x.com', 'http://x.com/'], // http คงเดิม ไม่ถูกบังคับเป็น https
  ])('normalize %s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it.each([
    'ftp://files.example.com',
    'file:///etc/passwd',
    'ws://s.example.com',
  ])('reject scheme ที่ไม่ใช่ http(s): %s', (bad) => {
    expect(() => normalizeUrl(bad)).toThrow(/UNSUPPORTED_URL/);
  });

  it('idempotent (normalize ซ้ำได้ค่าเดิม)', () => {
    const once = normalizeUrl('example.com/a');
    expect(normalizeUrl(once)).toBe(once);
  });
});

describe('urlHash / urlHashOrNull (contract ร่วม crawler ↔ enrichment)', () => {
  it('hash เท่ากันไม่ว่าจะรับ bare domain หรือ URL เต็ม (ตราบใดที่ normalize แล้วตรงกัน)', () => {
    // crawler เก็บ pages.url_hash = urlHash(normalizeUrl('example.com/a'))
    // enrichment คิด urlHashOrNull('https://example.com/a') → ต้องได้ค่าเดียวกัน
    expect(urlHashOrNull('https://example.com/a')).toBe(
      urlHash('example.com/a'),
    );
  });

  it('คืน null เมื่อ URL ว่าง/ใช้ไม่ได้ (best-effort join)', () => {
    expect(urlHashOrNull(null)).toBeNull();
    expect(urlHashOrNull('')).toBeNull();
    expect(urlHashOrNull('ftp://x.com')).toBeNull();
  });

  it('คืน sha1 (40 hex) เมื่อ URL ใช้ได้', () => {
    expect(urlHashOrNull('https://x.com')).toMatch(/^[0-9a-f]{40}$/);
  });
});
