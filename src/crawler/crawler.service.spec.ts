import { of } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import type { AxiosResponse } from 'axios';
import { CrawlerService } from './crawler.service';
import { crawlResultSchema } from './crawler.schema';
import type { CrawlResult } from './crawler.schema';
import { ssrfSafeHttpAgent, ssrfSafeHttpsAgent } from '../common/ssrf-guard';

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
  <p>ย่อหน้าที่สอง</p>
  <p>   </p>
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
    let page: Awaited<ReturnType<CrawlerService['crawl']>>;
    let result: CrawlResult;

    beforeAll(async () => {
      service = makeService(makeResponse(FIXTURE_HTML));
      page = await service.crawl('https://example.com/seo');
      result = page.result;
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

    it('แกะ paragraphs จาก <p> (เรียงตามเอกสาร, ข้ามย่อหน้าว่าง)', () => {
      expect(result.paragraphs).toEqual([
        'เนื้อหา หนึ่ง สอง สาม',
        'ย่อหน้าที่สอง',
      ]);
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

    it('เก็บรายรูป (imageRows) — src absolute + alt/hasAlt ต่อรูป (→ page_images)', () => {
      expect(result.imageRows).toHaveLength(2);
      const a = result.imageRows.find((i) => i.src.endsWith('/a.png'));
      expect(a).toEqual({
        src: 'https://example.com/a.png',
        alt: 'มีคำอธิบาย',
        hasAlt: true,
      });
      const b = result.imageRows.find((i) => i.src.endsWith('/b.png'));
      expect(b).toEqual({
        src: 'https://example.com/b.png',
        alt: null,
        hasAlt: false,
      });
    });

    it('คืน rawHtml ดิบ (สำหรับ R2) แยกจาก CrawlResult', () => {
      expect(page.rawHtml).toContain('<html');
      // rawHtml ต้องไม่ถูกยัดลง CrawlResult (กัน bloat returnvalue/response)
      expect(result).not.toHaveProperty('rawHtml');
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
      const page = await service.crawl('https://example.com/data.json');
      const result = page.result;
      expect(result.httpStatus).toBe(200);
      expect(result.title).toBeNull();
      expect(result.links).toEqual([]);
      expect(result.imageRows).toEqual([]);
      expect(result.paragraphs).toEqual([]);
      expect(result.wordCount).toBe(0);
      // non-HTML → ไม่มี rawHtml ให้ขึ้น R2
      expect(page.rawHtml).toBeNull();
      // snapshot ขั้นต่ำก็ยังต้องเป็น CrawlResult ที่ valid
      expect(() => crawlResultSchema.parse(result)).not.toThrow();
    });
  });

  describe('crawl() — error status', () => {
    it('ยังเก็บ snapshot ได้แม้ 404 (validateStatus ปล่อยผ่าน)', async () => {
      const service = makeService(
        makeResponse('<html><body>not found</body></html>', 'text/html', 404),
      );
      const { result } = await service.crawl('https://example.com/missing');
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
      const { result } = await service.crawl('https://example.com/up');
      expect(result.title).toBe('UP');
      expect(result.wordCount).toBeGreaterThan(0);
    });
  });

  describe('crawl() — wordCount ภาษาไทย (ไม่มีช่องว่างคั่นคำ)', () => {
    // เอกสาร 01 page_snapshots.word_count เป็น metric SEO จริง และระบบเป็น Thai SEO.
    // ไทยไม่เว้นวรรคระหว่างคำ → split(' ') นับทั้งย่อหน้าเป็น 1 คำ (ผิด).
    // ต้องใช้การตัดคำ (Intl.Segmenter) ให้ได้จำนวนคำจริง.
    it('นับคำไทยที่ติดกันด้วยการตัดคำ ไม่ใช่นับช่องว่าง', async () => {
      const service = makeService(
        makeResponse(
          '<html><body><p>ผมชอบกินข้าวเช้านี้</p></body></html>',
          'text/html',
        ),
      );
      const { result } = await service.crawl('https://example.com/th');
      // ผม|ชอบ|กิน|ข้าว|เช้า|นี้ = 6 คำ ; split(' ') เดิมจะได้ 1
      expect(result.wordCount).toBe(6);
    });

    it('นับคำไทยปนอังกฤษได้ถูก (ตัดคำไทย + แยกคำอังกฤษ)', async () => {
      const service = makeService(
        makeResponse(
          '<html><body><p>SEO คือการทำเว็บ</p></body></html>',
          'text/html',
        ),
      );
      const { result } = await service.crawl('https://example.com/mix');
      // SEO | คือ | การ | ทำ | เว็บ = 5 คำ ; split(' ') เดิมจะได้ 2
      expect(result.wordCount).toBe(5);
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
      ['myhost:3000', 'https://myhost:3000/'], // single-label host + port (เดิมใช้ localhost — ย้ายไปเทสที่ ssrf-guard.spec ∵ guard บล็อก localhost)
      ['http://x.com', 'http://x.com/'], // http คงเดิม ไม่ถูกบังคับเป็น https
    ])('normalize %s → %s', async (input, expected) => {
      const service = makeService(makeResponse('<html><body>x</body></html>'));
      const { result } = await service.crawl(input);
      expect(result.url).toBe(expected);
    });
  });

  describe('crawl() — guard wiring (SSRF + decompression-size cap)', () => {
    // options ที่ crawl() ส่งให้ axios — เฉพาะ field ที่ทดสอบ (กัน any จาก mock.calls)
    interface GetOpts {
      maxContentLength: number;
      httpAgent: unknown;
      httpsAgent: unknown;
      beforeRedirect: (o: { hostname?: string; host?: string }) => void;
    }

    // ประกอบ service + คืน mock fn ของ http.get เพื่อตรวจ options ที่ส่งให้ axios
    function makeWithSpy() {
      const get = jest
        .fn()
        .mockReturnValue(of(makeResponse('<html><body>x</body></html>')));
      const http = { get } as unknown as HttpService;
      const defaults: Record<string, unknown> = {
        CRAWLER_USER_AGENT: 'test-agent',
        CRAWLER_TIMEOUT_MS: 15000,
        CRAWLER_MAX_BYTES: 5_000_000,
        CRAWLER_MAX_REDIRECTS: 5,
      };
      const config = {
        get: (k: string) => defaults[k],
      } as unknown as ConfigService;
      return { service: new CrawlerService(http, config), get };
    }

    it('ส่ง maxContentLength (กัน decompression bomb) + ssrf agents + beforeRedirect ให้ axios', async () => {
      const { service, get } = makeWithSpy();
      await service.crawl('https://example.com/');
      const opts = (get.mock.calls[0] as unknown[])[1] as GetOpts;
      // axios enforce maxContentLength บน stream "หลัง" gunzip (http adapter) → gzip bomb ถูกตัดที่เพดานนี้
      expect(opts.maxContentLength).toBe(5_000_000);
      expect(opts.httpAgent).toBe(ssrfSafeHttpAgent);
      expect(opts.httpsAgent).toBe(ssrfSafeHttpsAgent);
      expect(typeof opts.beforeRedirect).toBe('function');
    });

    it('beforeRedirect บล็อก redirect ไป host ภายใน แต่ปล่อย host สาธารณะ', async () => {
      const { service, get } = makeWithSpy();
      await service.crawl('https://example.com/');
      const opts = (get.mock.calls[0] as unknown[])[1] as GetOpts;
      expect(() =>
        opts.beforeRedirect({ hostname: '169.254.169.254' }),
      ).toThrow(/SSRF_BLOCKED/);
      expect(() =>
        opts.beforeRedirect({ hostname: 'example.org' }),
      ).not.toThrow();
    });

    it('ปฏิเสธ (ไม่ยิง http) เมื่อ URL ชี้ host ภายใน', async () => {
      const { service, get } = makeWithSpy();
      await expect(service.crawl('http://127.0.0.1:6379/')).rejects.toThrow(
        /SSRF_BLOCKED/,
      );
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('crawl() — ลิงก์/รูปที่ resolve เป็นหน้าตัวเอง ต้องไม่ถูกนับ (phantom rows)', () => {
    // new URL('', base)/('#x', base)/('   ', base) ไม่ throw แต่คืน URL ของหน้าตัวเอง →
    // ถ้าไม่กรองก่อน resolve จะได้ internal link ปลอม (href="" = self-link บัง orphan) + image ปลอม
    const HTML = `<html><head><title>t</title></head><body>
      <a href="#">top</a>
      <a href="#section">jump</a>
      <a href="">self</a>
      <a href="   ">blank</a>
      <a href="/real">real internal</a>
      <img alt="no src" />
      <img src="" alt="empty src" />
      <img src="/real.png" alt="ok" />
    </body></html>`;

    it('ข้าม href ว่าง/fragment + <img> ไม่มี src — ไม่สร้าง link/image ปลอม', async () => {
      const service = makeService(makeResponse(HTML));
      const { result } = await service.crawl('https://example.com/p');
      // เหลือเฉพาะ /real — #, #section, "", "   " ถูกข้ามก่อน resolve
      expect(result.links).toHaveLength(1);
      expect(result.internalLinks).toBe(1);
      expect(result.links[0].url).toBe('https://example.com/real');
      // เหลือเฉพาะ /real.png — <img> ไม่มี src และ src="" ถูกข้าม (ไม่พอง imagesMissingAlt)
      expect(result.imageRows).toHaveLength(1);
      expect(result.images.total).toBe(1);
      expect(result.images.missingAlt).toBe(0);
      expect(result.imageRows[0].src).toBe('https://example.com/real.png');
    });
  });

  describe('crawl() — finalUrl normalize (กัน redirectTo false-positive)', () => {
    it('normalize responseUrl ให้เป็นรูป canonical เดียวกับ url (ไม่มี redirect จริง)', async () => {
      // server ตอบ responseUrl ไม่มี trailing slash แม้ไม่ได้ redirect → ต้อง normalize ให้เท่า url
      const service = makeService(
        makeResponse(
          '<html><body>x</body></html>',
          'text/html',
          200,
          'https://example.com',
        ),
      );
      const { result } = await service.crawl('https://example.com/');
      expect(result.finalUrl).toBe('https://example.com/');
      expect(result.finalUrl).toBe(result.url); // → repo จะตั้ง redirectTo = null
    });
  });
});
