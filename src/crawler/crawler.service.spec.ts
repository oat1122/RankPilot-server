import { of } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { AxiosResponse } from 'axios';
import { CrawlerService } from './crawler.service';
import { crawlResultSchema } from './crawler.schema';

// HTML fixture ครอบคลุมทุกฟิลด์ที่ bot ต้องแกะ (เอกสาร 01 page_snapshots)
const FIXTURE_HTML = `<!doctype html>
<html lang="th">
<head>
  <title>  RankPilot — SEO อัตโนมัติ </title>
  <meta name="description" content="วิเคราะห์ keyword และ on-page อัตโนมัติ" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="https://example.com/seo" />
  <script type="application/ld+json">
    { "@context": "https://schema.org", "@type": "Article", "headline": "x" }
  </script>
  <style>.x{color:red}</style>
</head>
<body>
  <h1>หัวข้อหลัก</h1>
  <h2>หัวข้อย่อย A</h2>
  <h2>หัวข้อย่อย B</h2>
  <h3>ย่อยลึก</h3>
  <p>เนื้อหา หนึ่ง สอง สาม</p>
  <a href="/about">เกี่ยวกับเรา</a>
  <a href="https://other-site.com/x" rel="nofollow">ลิงก์นอก</a>
  <a href="mailto:hi@example.com">เมล</a>
  <img src="/a.png" alt="มีคำอธิบาย" />
  <img src="/b.png" />
  <script>console.log('ไม่ควรถูกนับเป็นคำ')</script>
</body>
</html>`;

function makeResponse(
  data: unknown,
  contentType = 'text/html; charset=utf-8',
  status = 200,
  responseUrl = 'https://example.com/seo',
): AxiosResponse {
  return {
    data,
    status,
    statusText: 'OK',
    headers: { 'content-type': contentType },
    config: {} as AxiosResponse['config'],
    request: { res: { responseUrl } },
  } as AxiosResponse;
}

function makeService(response: AxiosResponse): CrawlerService {
  const http = {
    get: jest.fn().mockReturnValue(of(response)),
  } as unknown as HttpService;

  const defaults: Record<string, unknown> = {
    CRAWLER_USER_AGENT: 'test-agent',
    CRAWLER_TIMEOUT_MS: 15000,
    CRAWLER_MAX_BYTES: 5_000_000,
    CRAWLER_MAX_REDIRECTS: 5,
  };
  const config = {
    get: (k: string) => defaults[k],
  } as unknown as ConfigService;

  return new CrawlerService(http, config);
}

describe('CrawlerService', () => {
  describe('crawl() — HTML page', () => {
    let service: CrawlerService;
    let result: Awaited<ReturnType<CrawlerService['crawl']>>;

    beforeAll(async () => {
      service = makeService(makeResponse(FIXTURE_HTML));
      result = await service.crawl('https://example.com/seo');
    });

    it('แกะ title / meta / canonical / robots (trim ช่องว่าง)', () => {
      expect(result.title).toBe('RankPilot — SEO อัตโนมัติ');
      expect(result.metaDescription).toBe(
        'วิเคราะห์ keyword และ on-page อัตโนมัติ',
      );
      expect(result.canonical).toBe('https://example.com/seo');
      expect(result.robotsMeta).toBe('index,follow');
    });

    it('แกะ headings + h1 ตัวแรก', () => {
      expect(result.h1).toBe('หัวข้อหลัก');
      expect(result.headings.h2).toEqual(['หัวข้อย่อย A', 'หัวข้อย่อย B']);
      expect(result.headings.h3).toEqual(['ย่อยลึก']);
    });

    it('แกะ schemaTypes จาก JSON-LD', () => {
      expect(result.schemaTypes).toEqual(['Article']);
    });

    it('resolve ลิงก์ + แยก internal/external, ข้าม mailto:', () => {
      // /about (internal) + other-site.com (external) = 2 ; mailto ถูกข้าม
      expect(result.links).toHaveLength(2);
      expect(result.internalLinks).toBe(1);
      expect(result.externalLinks).toBe(1);
      const about = result.links.find((l) => l.isInternal);
      expect(about?.url).toBe('https://example.com/about');
      expect(about?.anchorText).toBe('เกี่ยวกับเรา');
      const external = result.links.find((l) => !l.isInternal);
      expect(external?.rel).toBe('nofollow');
    });

    it('นับรูป + รูปที่ขาด alt', () => {
      expect(result.images.total).toBe(2);
      expect(result.images.missingAlt).toBe(1);
    });

    it('คำนวณ wordCount จาก body ที่ตัด script/style แล้ว + contentHash sha1', () => {
      expect(result.wordCount).toBeGreaterThan(0);
      expect(result.bodyText).not.toContain('ไม่ควรถูกนับเป็นคำ');
      expect(result.bodyText).not.toContain('color:red');
      expect(result.contentHash).toMatch(/^[0-9a-f]{40}$/);
    });

    it('เก็บ metadata ระดับ HTTP (status/finalUrl/contentType/fetchedAt)', () => {
      expect(result.httpStatus).toBe(200);
      expect(result.finalUrl).toBe('https://example.com/seo');
      expect(result.contentType).toContain('text/html');
      expect(() => new Date(result.fetchedAt).toISOString()).not.toThrow();
    });

    // contract: ผลต้อง parse ผ่าน crawlResultSchema เสมอ — Phase 1 เอาไปเขียน DB ตรง ๆ (เอกสาร 01)
    it('ผลลัพธ์ผ่าน crawlResultSchema', () => {
      expect(() => crawlResultSchema.parse(result)).not.toThrow();
    });
  });

  describe('crawl() — non-HTML', () => {
    it('คืน snapshot ขั้นต่ำ (ไม่ parse) เมื่อ content-type ไม่ใช่ html', async () => {
      const service = makeService(
        makeResponse('{"k":1}', 'application/json', 200),
      );
      const result = await service.crawl('https://example.com/data.json');
      expect(result.httpStatus).toBe(200);
      expect(result.title).toBeNull();
      expect(result.links).toEqual([]);
      expect(result.wordCount).toBe(0);
      // snapshot ขั้นต่ำก็ยังต้องเป็น CrawlResult ที่ valid
      expect(() => crawlResultSchema.parse(result)).not.toThrow();
    });
  });

  describe('crawl() — error status', () => {
    it('ยังเก็บ snapshot ได้แม้ 404 (validateStatus ปล่อยผ่าน)', async () => {
      const service = makeService(
        makeResponse('<html><body>not found</body></html>', 'text/html', 404),
      );
      const result = await service.crawl('https://example.com/missing');
      expect(result.httpStatus).toBe(404);
      expect(result.wordCount).toBeGreaterThan(0);
    });
  });

  describe('crawl() — content-type case-insensitive', () => {
    // media type ใน Content-Type ไม่สนตัวพิมพ์ (RFC 7231) → TEXT/HTML ต้อง parse เหมือน text/html
    it('parse หน้า HTML ที่ส่ง Content-Type ตัวพิมพ์ใหญ่ (TEXT/HTML)', async () => {
      const service = makeService(
        makeResponse(
          '<html><head><title>UP</title></head><body><p>w1 w2</p></body></html>',
          'TEXT/HTML; charset=UTF-8',
        ),
      );
      const result = await service.crawl('https://example.com/up');
      expect(result.title).toBe('UP');
      expect(result.wordCount).toBeGreaterThan(0);
    });
  });

  describe('crawl() — normalizeUrl scheme handling', () => {
    // เติม https:// เฉพาะ bare domain; scheme อื่น (ftp/file/ws) ต้อง reject ไม่ใช่ mangle
    it.each([
      'ftp://files.example.com',
      'file:///etc/passwd',
      'ws://s.example.com',
    ])('reject scheme ที่ crawl ไม่ได้: %s', async (bad) => {
      const service = makeService(makeResponse('<html><body>x</body></html>'));
      await expect(service.crawl(bad)).rejects.toThrow(/UNSUPPORTED_URL/);
    });

    it.each([
      ['example.com', 'https://example.com/'],
      ['example.com:8080', 'https://example.com:8080/'], // bare domain + port ต้องไม่ถูกมองเป็น scheme
      ['localhost:3000', 'https://localhost:3000/'],
      ['http://x.com', 'http://x.com/'], // http คงเดิม ไม่ถูกบังคับเป็น https
    ])('normalize %s → %s', async (input, expected) => {
      const service = makeService(makeResponse('<html><body>x</body></html>'));
      const result = await service.crawl(input);
      expect(result.url).toBe(expected);
    });
  });
});
