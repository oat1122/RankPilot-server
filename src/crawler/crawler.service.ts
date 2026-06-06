import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AxiosResponse } from 'axios';
import type { CrawlHeadings, CrawlLink, CrawlResult } from './crawler.schema';

/** ฟิลด์ที่ได้จากการ parse HTML ล้วน ๆ (ไม่รวม metadata ระดับ HTTP) */
type ParsedPage = Pick<
  CrawlResult,
  | 'title'
  | 'metaDescription'
  | 'h1'
  | 'headings'
  | 'canonical'
  | 'robotsMeta'
  | 'schemaTypes'
  | 'links'
  | 'internalLinks'
  | 'externalLinks'
  | 'images'
  | 'wordCount'
  | 'contentHash'
  | 'bodyText'
>;

/**
 * CrawlerService — "bot" ที่อ่านเว็บไซต์ผ่าน URL (เอกสาร 00 §0 [1] Crawler).
 *
 * MVP ใช้ Cheerio (หน้า static) ตามเอกสาร 00 §1 — ประหยัดกว่า Playwright ซึ่งสงวนไว้
 * สำหรับหน้า JS-render ภายหลัง. โค้ดนี้ตั้งใจให้ย้ายเข้า apps/worker ได้ (เอกสาร 04).
 *
 * กฎเหล็ก api ≠ worker (เอกสาร 00 §4): service นี้ถูกเรียกจาก worker process เท่านั้น
 * (ผ่าน CrawlProcessor) — ไม่เรียกตรงจาก request thread ของ api.
 */
@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  // ตัดคำด้วย ICU (Intl.Segmenter) — สร้างครั้งเดียว reuse ได้ (stateless)
  private readonly wordSegmenter = new Intl.Segmenter('th', {
    granularity: 'word',
  });

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** ดึง 1 URL → คืนข้อมูล on-page (map กับ page_snapshots เอกสาร 01). */
  async crawl(rawUrl: string): Promise<CrawlResult> {
    const url = this.normalizeUrl(rawUrl);

    const res = await firstValueFrom(
      this.http.get<string>(url, {
        timeout: this.config.get<number>('CRAWLER_TIMEOUT_MS'),
        maxRedirects: this.config.get<number>('CRAWLER_MAX_REDIRECTS'),
        maxContentLength: this.config.get<number>('CRAWLER_MAX_BYTES'),
        responseType: 'text',
        transformResponse: (d: string) => d, // เก็บ raw HTML — กัน axios แปลงเป็น object
        validateStatus: () => true, // จับทุก status เอง → เก็บ snapshot ได้แม้ 4xx/5xx
        headers: {
          'User-Agent': this.config.get<string>('CRAWLER_USER_AGENT')!,
          Accept: 'text/html,application/xhtml+xml',
        },
      }),
    );

    const httpStatus = res.status;
    const finalUrl = this.resolveFinalUrl(res, url);
    const ctHeader = res.headers['content-type'];
    const contentType = typeof ctHeader === 'string' ? ctHeader : '';
    const fetchedAt = new Date().toISOString();
    const meta = { url, finalUrl, httpStatus, contentType, fetchedAt };

    // ไม่ใช่ HTML → คืน snapshot ขั้นต่ำ (ไม่ parse) เพื่อยังเก็บประวัติ status ได้
    // เทียบแบบ case-insensitive ∵ media type ใน Content-Type ไม่สนตัวพิมพ์ (RFC 7231 §3.1.1.1)
    if (
      !contentType.toLowerCase().includes('html') ||
      typeof res.data !== 'string'
    ) {
      this.logger.debug(`non-html (${contentType}) ${finalUrl}`);
      return { ...meta, ...this.blankParse() };
    }

    return { ...meta, ...this.parseHtml(res.data, finalUrl) };
  }

  /** แกะ HTML → on-page fields. แยกเป็น pure method เพื่อทดสอบได้โดยไม่แตะ network. */
  parseHtml(html: string, baseUrl: string): ParsedPage {
    const $ = cheerio.load(html);
    const base = this.safeUrl(baseUrl);

    // ดึง JSON-LD ก่อน แล้วค่อยตัด <script> ทิ้งตอนคำนวณ text
    const schemaTypes = this.extractSchemaTypes($);

    const headings: CrawlHeadings = {
      h1: this.collectText($, 'h1'),
      h2: this.collectText($, 'h2'),
      h3: this.collectText($, 'h3'),
    };

    const links: CrawlLink[] = [];
    $('a[href]').each((_, el) => {
      const abs = this.safeUrl($(el).attr('href') ?? '', base ?? undefined);
      if (!abs || (abs.protocol !== 'http:' && abs.protocol !== 'https:'))
        return;
      links.push({
        url: abs.toString(),
        anchorText: this.collapse($(el).text()) || null,
        rel: $(el).attr('rel') ?? null,
        isInternal: base != null && abs.host === base.host,
      });
    });
    const internalLinks = links.filter((l) => l.isInternal).length;

    let imagesTotal = 0;
    let imagesMissingAlt = 0;
    $('img').each((_, el) => {
      imagesTotal += 1;
      const alt = $(el).attr('alt');
      if (alt === undefined || this.collapse(alt) === '') imagesMissingAlt += 1;
    });

    // body text หลังตัด script/style/noscript/template เพื่อไม่ให้ปนคำใน wordCount/hash
    $('script, style, noscript, template').remove();
    const bodyText = this.collapse($('body').text());
    const wordCount = this.countWords(bodyText);

    return {
      title: this.textOrNull($('head > title').first().text()),
      metaDescription: this.attrOrNull(
        $('meta[name="description"]').attr('content'),
      ),
      h1: headings.h1[0] ?? null,
      headings,
      canonical: this.attrOrNull($('link[rel="canonical"]').attr('href')),
      robotsMeta: this.attrOrNull($('meta[name="robots"]').attr('content')),
      schemaTypes,
      links,
      internalLinks,
      externalLinks: links.length - internalLinks,
      images: { total: imagesTotal, missingAlt: imagesMissingAlt },
      wordCount,
      contentHash: createHash('sha1').update(bodyText).digest('hex'),
      bodyText,
    };
  }

  /** ค่า on-page ว่าง สำหรับเพจที่ไม่ parse (non-HTML / error body). */
  private blankParse(): ParsedPage {
    return {
      title: null,
      metaDescription: null,
      h1: null,
      headings: { h1: [], h2: [], h3: [] },
      canonical: null,
      robotsMeta: null,
      schemaTypes: [],
      links: [],
      internalLinks: 0,
      externalLinks: 0,
      images: { total: 0, missingAlt: 0 },
      wordCount: 0,
      contentHash: createHash('sha1').update('').digest('hex'),
      bodyText: '',
    };
  }

  /** เก็บ @type จาก JSON-LD ทุกบล็อก (รองรับ array + @graph). */
  private extractSchemaTypes($: cheerio.CheerioAPI): string[] {
    const types = new Set<string>();
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).text();
      if (!raw.trim()) return;
      try {
        this.collectTypes(JSON.parse(raw), types);
      } catch {
        // JSON-LD เสีย → ข้าม ไม่ให้ crawl ล้มทั้งหน้า
      }
    });
    return [...types].sort();
  }

  private collectTypes(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
      node.forEach((n) => this.collectTypes(n, out));
      return;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const t = obj['@type'];
      if (typeof t === 'string') out.add(t);
      else if (Array.isArray(t))
        t.forEach((x) => typeof x === 'string' && out.add(x));
      if ('@graph' in obj) this.collectTypes(obj['@graph'], out);
    }
  }

  /** http://, https:// เท่านั้น; เติม https:// ให้ถ้าส่ง bare domain มาจาก worker. */
  private normalizeUrl(raw: string): string {
    const trimmed = raw.trim();
    // มี scheme://อยู่แล้ว (เช่น ftp://, ws://, file://) → ห้ามเติม https:// ทับ
    // ∵ จะได้ URL เพี้ยน (ftp://x → https://ftp//x) แทนที่จะ reject อย่างถูกต้อง;
    // ตรวจเฉพาะรูป scheme:// เพื่อไม่ชน bare domain ที่มี port (example.com:8080).
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = this.safeUrl(withProto);
    if (
      !parsed ||
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    )
      throw new Error(`UNSUPPORTED_URL: ${raw}`);
    return parsed.toString();
  }

  private resolveFinalUrl(res: AxiosResponse, fallback: string): string {
    const req = res.request as { res?: { responseUrl?: string } } | undefined;
    return req?.res?.responseUrl ?? fallback;
  }

  private collectText($: cheerio.CheerioAPI, selector: string): string[] {
    return $(selector)
      .map((_, el) => this.collapse($(el).text()))
      .get()
      .filter((s) => s.length > 0);
  }

  private safeUrl(input: string, base?: URL): URL | null {
    try {
      return base ? new URL(input, base) : new URL(input);
    } catch {
      return null;
    }
  }

  private collapse(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  /**
   * นับจำนวนคำแบบรองรับหลายภาษา (เอกสาร 01 page_snapshots.word_count).
   * ใช้ตัดคำของ ICU ∵ ไทย/ญี่ปุ่น/จีน ไม่เว้นวรรคระหว่างคำ — split(' ') จะนับ
   * ทั้งย่อหน้าเป็น 1 คำ ทำให้ metric SEO ผิด. นับเฉพาะ segment ที่เป็นคำจริง
   * (isWordLike) → ข้ามช่องว่าง/เครื่องหมายวรรคตอน; ยังแยกคำอังกฤษได้ถูกด้วย.
   */
  private countWords(text: string): number {
    if (!text) return 0;
    let count = 0;
    for (const seg of this.wordSegmenter.segment(text)) {
      if (seg.isWordLike) count += 1;
    }
    return count;
  }

  private textOrNull(s: string): string | null {
    return this.collapse(s) || null;
  }

  private attrOrNull(v: string | undefined): string | null {
    return v == null ? null : this.collapse(v) || null;
  }
}
