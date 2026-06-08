import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AxiosResponse } from 'axios';
import { normalizeUrl } from '../common/url';
import {
  assertHostAllowed,
  assertPublicUrl,
  ssrfSafeHttpAgent,
  ssrfSafeHttpsAgent,
} from '../common/ssrf-guard';
import type {
  CrawledPage,
  CrawlHeadings,
  CrawlImage,
  CrawlLink,
  CrawlResult,
} from './crawler.schema';

/** ฟิลด์ที่ได้จากการ parse HTML ล้วน ๆ (ไม่รวม metadata ระดับ HTTP) */
type ParsedPage = Pick<
  CrawlResult,
  | 'title'
  | 'metaDescription'
  | 'h1'
  | 'headings'
  | 'paragraphs'
  | 'canonical'
  | 'robotsMeta'
  | 'schemaTypes'
  | 'links'
  | 'internalLinks'
  | 'externalLinks'
  | 'images'
  | 'imageRows'
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

  /**
   * ดึง 1 URL → CrawledPage = on-page (map page_snapshots เอกสาร 01) + rawHtml ดิบ.
   * rawHtml แยกออกจาก CrawlResult เพื่อส่งขึ้น R2 โดยไม่ bloat job.returnvalue/response.
   */
  async crawl(rawUrl: string): Promise<CrawledPage> {
    const url = normalizeUrl(rawUrl);
    // SSRF guard — กันยิง resource ภายใน (localhost/LAN/cloud metadata). โยน SSRF_BLOCKED
    // → กลายเป็น job.failedReason (ตาม pattern UNSUPPORTED_URL ของ normalizeUrl). ดู common/ssrf-guard.
    assertPublicUrl(url);

    const res = await firstValueFrom(
      this.http.get<string>(url, {
        timeout: this.config.get<number>('CRAWLER_TIMEOUT_MS'),
        maxRedirects: this.config.get<number>('CRAWLER_MAX_REDIRECTS'),
        maxContentLength: this.config.get<number>('CRAWLER_MAX_BYTES'),
        // SSRF guard ชั้น socket: custom dns lookup ปฏิเสธ IP ภายใน (กัน DNS rebinding)
        httpAgent: ssrfSafeHttpAgent,
        httpsAgent: ssrfSafeHttpsAgent,
        // เช็คทุก redirect hop ด้วย (axios/follow-redirects เรียกก่อนตามแต่ละ Location) —
        // กัน redirect ไป IP ภายในตรง ๆ ที่ lookup ข้าม (net ไม่ resolve host ที่เป็น IP literal)
        beforeRedirect: (opts: { hostname?: string; host?: string }) =>
          assertHostAllowed(opts.hostname ?? opts.host),
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
      // non-HTML → ไม่มี rawHtml ให้เก็บขึ้น R2
      return { result: { ...meta, ...this.blankParse() }, rawHtml: null };
    }

    return {
      result: { ...meta, ...this.parseHtml(res.data, finalUrl) },
      rawHtml: res.data,
    };
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

    // ย่อหน้า <p> — เก็บก่อนตัด script/style (เหมือน headings) เป็น text ต่อย่อหน้า
    // ข้ามย่อหน้าว่าง (collectText filter แล้ว). ใช้วิเคราะห์โครงสร้าง/intro (เอกสาร 01).
    const paragraphs = this.collectText($, 'p');

    const links: CrawlLink[] = [];
    $('a[href]').each((_, el) => {
      // ข้าม href ว่าง/whitespace/fragment ล้วน — new URL('', base)/('#x', base) ไม่ throw แต่
      // resolve เป็น URL "หน้าตัวเอง" → internal link ปลอม + self-link (href="") บัง orphan detector
      const href = ($(el).attr('href') ?? '').trim();
      if (!href || href.startsWith('#')) return;
      const abs = this.safeUrl(href, base ?? undefined);
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

    // เก็บรายรูป (→ page_images) + นับรวมจากชุดเดียวกันให้ตรงกันเสมอ. นับเฉพาะรูปที่มี src
    // ใช้ได้ (resolve ได้ + ยาวไม่เกิน column 2048) ∵ page_images.src NOT NULL varchar(2048);
    // alt ว่าง/ไม่มี = hasAlt:false (ตรรกะ missingAlt เดิม).
    const imageRows: CrawlImage[] = [];
    $('img').each((_, el) => {
      // ข้าม <img> ไม่มี src/ว่าง — new URL('', base) ไม่ throw แต่ resolve เป็น URL หน้าตัวเอง
      // → image row ปลอม (src=หน้าตัวเอง) + พอง imagesMissingAlt (เอกสาร: "นับเฉพาะรูปที่มี src")
      const rawSrc = ($(el).attr('src') ?? '').trim();
      if (!rawSrc) return;
      const abs = this.safeUrl(rawSrc, base ?? undefined);
      const src = abs ? abs.toString() : '';
      if (!src || src.length > 2048) return;
      const alt = this.attrOrNull($(el).attr('alt'));
      imageRows.push({ src, alt, hasAlt: alt != null });
    });
    const imagesTotal = imageRows.length;
    const imagesMissingAlt = imageRows.filter((i) => !i.hasAlt).length;

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
      paragraphs,
      canonical: this.attrOrNull($('link[rel="canonical"]').attr('href')),
      robotsMeta: this.attrOrNull($('meta[name="robots"]').attr('content')),
      schemaTypes,
      links,
      internalLinks,
      externalLinks: links.length - internalLinks,
      images: { total: imagesTotal, missingAlt: imagesMissingAlt },
      imageRows,
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
      paragraphs: [],
      canonical: null,
      robotsMeta: null,
      schemaTypes: [],
      links: [],
      internalLinks: 0,
      externalLinks: 0,
      images: { total: 0, missingAlt: 0 },
      imageRows: [],
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

  private resolveFinalUrl(res: AxiosResponse, fallback: string): string {
    const req = res.request as { res?: { responseUrl?: string } } | undefined;
    const raw = req?.res?.responseUrl ?? fallback;
    // normalize ให้เป็นรูปเดียวกับ url ที่ขอ (idempotent) — ไม่งั้น redirectTo (repo) จะ false-positive
    // เมื่อ responseUrl ต่างจาก url แค่ trailing slash/รูป canonical, และ url_hash/storage key ฝั่ง
    // persist จะคิดจาก finalUrl นี้ (ดู crawler.repo upsertPageTx). fallback ถูก normalize มาแล้ว.
    try {
      return normalizeUrl(raw);
    } catch {
      return fallback;
    }
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
