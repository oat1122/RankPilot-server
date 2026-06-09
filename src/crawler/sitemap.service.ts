import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import { normalizeUrl } from '../common/url';
import {
  assertHostAllowed,
  assertPublicUrl,
  ssrfSafeHttpAgent,
  ssrfSafeHttpsAgent,
} from '../common/ssrf-guard';

/**
 * SitemapService — discover URL ของ domain สำหรับ site crawl (stage [1] multi-page).
 * อ่าน robots.txt → บรรทัด `Sitemap:` (ไม่มี → เดา /sitemap.xml) แล้ว parse sitemap (รองรับ
 * <sitemapindex> recurse + <urlset>). กรอง same-host + http/https, dedup, cap จำนวน. ทุก request
 * ผ่าน SSRF guard เดียวกับ CrawlerService (กันยิง resource ภายใน). best-effort: พังที่ใด = ข้าม.
 * รันใน worker เท่านั้น (เรียกจาก CrawlProcessor — เอกสาร 00 §4).
 */
@Injectable()
export class SitemapService {
  private readonly logger = new Logger(SitemapService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * คืน seed URL ของ site crawl = [หน้าแรก] ∪ [URL จาก sitemap] (same-host, normalize, cap).
   * BFS ใน processor จะเดิน internal link ต่อจาก seed เหล่านี้.
   */
  async discover(domain: string): Promise<string[]> {
    const base = normalizeUrl(domain); // https://{domain}/
    const origin = new URL(base);
    const host = origin.host;
    const maxUrls = this.config.get<number>('CRAWLER_SITEMAP_MAX_URLS') ?? 2000;

    const found = new Set<string>([base]); // seed หน้าแรกเสมอ

    // robots.txt → Sitemap: <url> (อาจมีหลายบรรทัด); ไม่มี/อ่านไม่ได้ → เดา /sitemap.xml
    const robots = await this.fetchText(
      new URL('/robots.txt', origin).toString(),
    );
    let sitemaps = robots
      ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
      : [];
    if (sitemaps.length === 0)
      sitemaps = [new URL('/sitemap.xml', origin).toString()];

    // fetch sitemap (รองรับ index ที่ชี้ไป sitemap ลูก) — cap จำนวนไฟล์กัน loop
    const seen = new Set<string>();
    const queue = [...sitemaps];
    let fetched = 0;
    while (queue.length > 0 && found.size < maxUrls && fetched < 50) {
      const sm = queue.shift()!;
      if (seen.has(sm)) continue;
      seen.add(sm);
      fetched += 1;
      const xml = await this.fetchText(sm);
      if (!xml) continue;
      const $ = cheerio.load(xml, { xmlMode: true });
      const isIndex = $('sitemapindex').length > 0;
      $('loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (!loc) return;
        if (isIndex) {
          queue.push(loc); // sitemap ลูก → recurse
          return;
        }
        try {
          const u = new URL(loc);
          if (
            (u.protocol === 'http:' || u.protocol === 'https:') &&
            u.host === host &&
            found.size < maxUrls
          )
            found.add(normalizeUrl(loc));
        } catch {
          // loc เพี้ยน → ข้าม
        }
      });
    }

    this.logger.log(
      `discover ${host}: seeds=${found.size} (sitemaps=${fetched})`,
    );
    return [...found];
  }

  /** ดึง text แบบ best-effort (robots/sitemap) — คืน null ถ้าพัง/4xx/ไม่ใช่ text. SSRF-guarded. */
  private async fetchText(url: string): Promise<string | null> {
    try {
      assertPublicUrl(url); // กันยิง resource ภายใน (โยน → caught → null)
      const res = await firstValueFrom(
        this.http.get<string>(url, {
          timeout: this.config.get<number>('CRAWLER_TIMEOUT_MS'),
          maxRedirects: this.config.get<number>('CRAWLER_MAX_REDIRECTS'),
          maxContentLength: this.config.get<number>('CRAWLER_MAX_BYTES'),
          httpAgent: ssrfSafeHttpAgent,
          httpsAgent: ssrfSafeHttpsAgent,
          beforeRedirect: (opts: { hostname?: string; host?: string }) =>
            assertHostAllowed(opts.hostname ?? opts.host),
          responseType: 'text',
          transformResponse: (d: string) => d,
          validateStatus: () => true,
          headers: {
            'User-Agent': this.config.get<string>('CRAWLER_USER_AGENT')!,
            Accept: 'application/xml,text/xml,text/plain,*/*',
          },
        }),
      );
      if (res.status >= 400 || typeof res.data !== 'string') return null;
      return res.data;
    } catch {
      return null;
    }
  }
}
