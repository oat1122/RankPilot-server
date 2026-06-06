import { createCrawlSchema } from './create-crawl.dto';

// Zod เป็น validation layer เดียว (เอกสาร 04 §6) — DTO ต้องรับเฉพาะ URL ที่ crawl ได้จริง
describe('createCrawlSchema', () => {
  const accepts = (url: string) => createCrawlSchema.safeParse({ url }).success;

  it('รับ http/https', () => {
    expect(accepts('http://example.com')).toBe(true);
    expect(accepts('https://example.com/path?q=1')).toBe(true);
  });

  it('ปฏิเสธ scheme ที่ crawl ไม่ได้ (mailto/javascript/ftp/file)', () => {
    // z.url() เพียว ๆ ปล่อยผ่าน → api จะ enqueue งานที่ worker reject แล้ว fail เสียเปล่า
    expect(accepts('mailto:hi@example.com')).toBe(false);
    expect(accepts('javascript:alert(1)')).toBe(false);
    expect(accepts('ftp://files.example.com')).toBe(false);
    expect(accepts('file:///etc/passwd')).toBe(false);
  });

  it('ปฏิเสธสตริงที่ไม่ใช่ URL', () => {
    expect(accepts('not a url')).toBe(false);
    expect(accepts('')).toBe(false);
  });

  it('projectId optional — ไม่ส่งก็ผ่าน (backward-compat)', () => {
    const r = createCrawlSchema.safeParse({ url: 'https://example.com' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.projectId).toBeUndefined();
  });

  it('projectId coerce เป็น int บวก', () => {
    const r = createCrawlSchema.safeParse({
      url: 'https://example.com',
      projectId: '7',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.projectId).toBe(7);
    // ปฏิเสธค่าที่ไม่ใช่ int บวก
    expect(
      createCrawlSchema.safeParse({ url: 'https://example.com', projectId: 0 })
        .success,
    ).toBe(false);
    expect(
      createCrawlSchema.safeParse({ url: 'https://example.com', projectId: -3 })
        .success,
    ).toBe(false);
  });
});
