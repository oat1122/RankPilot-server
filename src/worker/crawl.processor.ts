import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { CrawlerService } from '../crawler/crawler.service';
import { CrawlerRepo } from '../crawler/crawler.repo';
import { SitemapService } from '../crawler/sitemap.service';
import type { CrawlResult } from '../crawler/crawler.schema';
import { HtmlStorageService } from '../storage/html-storage.service';
import { PsiService } from '../psi/psi.service';
import { normalizeUrl, urlHash, urlHashOrNull } from '../common/url';

/**
 * payload ของ queue 'crawl' — discriminated union:
 *  - single-page (เดิม): {url, projectId?} (projectId มี = persist)
 *  - site (ใหม่): {mode:'site', projectId, maxPages} — discover sitemap + BFS internal links ทั้งเว็บ
 */
type PageCrawlJobData = { url: string; projectId?: number };
type SiteCrawlJobData = { mode: 'site'; projectId: number; maxPages: number };
type CrawlJobData = PageCrawlJobData | SiteCrawlJobData;
/** สรุปผล site crawl (job.returnvalue) — single-page ยังคืน CrawlResult เหมือนเดิม. */
type SiteCrawlSummary = {
  crawlId: number;
  pagesDiscovered: number;
  pagesCrawled: number;
};

/** นามสกุลที่ "ไม่น่าจะเป็น HTML" — ข้ามไม่เดิน BFS เข้าไป (ลดการ crawl ไฟล์ asset). */
const NON_HTML_EXT =
  /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|rss|pdf|zip|gz|tgz|rar|7z|mp4|webm|mp3|wav|avi|mov|woff2?|ttf|otf|eot|csv|xlsx?|docx?|pptx?)$/i;

/**
 * Consumer ของ queue 'crawl' (worker process — เอกสาร 00 §4).
 *  - single-page: crawl 1 URL → คืน CrawlResult (+persist ถ้ามี projectId).
 *  - site: discover sitemap + เดิน internal link แบบ BFS จนถึง maxPages, persist ทุกหน้าใต้ crawl เดียว.
 */
@Processor('crawl')
export class CrawlProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlProcessor.name);

  constructor(
    private readonly crawler: CrawlerService,
    private readonly repo: CrawlerRepo,
    private readonly storage: HtmlStorageService,
    private readonly psi: PsiService,
    private readonly sitemap: SitemapService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(
    job: Job<CrawlJobData>,
  ): Promise<CrawlResult | SiteCrawlSummary> {
    if ('mode' in job.data) {
      this.logger.log(
        `site-crawl#${job.id} project=${job.data.projectId} maxPages=${job.data.maxPages}`,
      );
      return this.processSite(job.data.projectId, job.data.maxPages);
    }

    this.logger.log(`crawl#${job.id} → ${job.data.url}`);
    const { result, rawHtml } = await this.crawler.crawl(job.data.url);
    this.logger.log(
      `crawl#${job.id} done status=${result.httpStatus} words=${result.wordCount} links=${result.links.length} images=${result.images.total}`,
    );
    if (job.data.projectId != null)
      await this.persist(job.data.projectId, result, rawHtml);
    return result;
  }

  /**
   * site crawl: 1 job = 1 crawls row = หลายหน้า. discover (sitemap) → BFS internal link จนถึง
   * maxPages (cap ซ้ำด้วย env CRAWLER_SITE_MAX_PAGES). persist ต่อหน้าแบบ best-effort (พังหน้าเดียว
   * ข้าม) แล้ว finishCrawl ทีเดียวตอนจบ. **ข้าม PSI/CWV** ใน site crawl เพื่อความเร็ว (analysis รับ null ได้).
   */
  private async processSite(
    projectId: number,
    maxPagesReq: number,
  ): Promise<SiteCrawlSummary> {
    const domain = await this.repo.projectDomain(projectId);
    if (!domain) throw new Error(`project ${projectId} not found (no domain)`);
    const hardCap = this.config.get<number>('CRAWLER_SITE_MAX_PAGES') ?? 200;
    const maxPages = Math.min(maxPagesReq, hardCap);
    const host = new URL(normalizeUrl(domain)).host;

    const crawlId = await this.repo.createCrawl(projectId, 'api');
    try {
      const queue: string[] = [];
      const discovered = new Set<string>();
      const visited = new Set<string>();
      const enqueue = (raw: string) => {
        const h = urlHashOrNull(raw);
        if (!h || discovered.has(h)) return;
        discovered.add(h);
        queue.push(raw);
      };
      for (const seed of await this.sitemap.discover(domain)) enqueue(seed);

      let crawled = 0;
      let hadError = false;
      while (queue.length > 0 && crawled < maxPages) {
        const url = queue.shift()!;
        const h = urlHashOrNull(url);
        if (h && visited.has(h)) continue;
        if (h) visited.add(h);
        try {
          const { result, rawHtml } = await this.crawler.crawl(url);
          const fh = urlHashOrNull(result.finalUrl);
          if (fh) visited.add(fh);
          const htmlStorageKey = await this.storage.putHtml({
            projectId,
            crawlId,
            urlHash: urlHash(result.finalUrl),
            html: rawHtml,
          });
          await this.repo.persistPageWithinCrawl({
            crawlId,
            projectId,
            result,
            htmlStorageKey,
            cwv: { lcpMs: null, clsX1000: null, inpMs: null }, // ข้าม PSI ใน site crawl
          });
          crawled += 1;
          // เดินต่อ: internal link ที่ same-host + น่าจะ HTML + ยังไม่ discovered (กัน frontier บานเกิน)
          if (queue.length + crawled < maxPages * 4) {
            for (const link of result.links) {
              if (!link.isInternal || !this.isHtmlLikely(link.url, host))
                continue;
              enqueue(link.url);
            }
          }
        } catch (err) {
          hadError = true;
          this.logger.warn(
            `site#${crawlId} page failed ${url}: ${(err as Error).message}`,
          );
        }
      }

      const status: 'done' | 'partial' | 'failed' =
        crawled === 0
          ? 'failed'
          : hadError || crawled < discovered.size
            ? 'partial'
            : 'done';
      await this.repo.finishCrawl(crawlId, {
        status,
        pagesDiscovered: discovered.size,
        pagesCrawled: crawled,
      });
      this.logger.log(
        `site#${crawlId} project=${projectId} discovered=${discovered.size} crawled=${crawled} status=${status}`,
      );
      return {
        crawlId,
        pagesDiscovered: discovered.size,
        pagesCrawled: crawled,
      };
    } catch (err) {
      await this.repo.markFailed(crawlId).catch(() => undefined);
      throw err;
    }
  }

  /** เขียนผล crawl ลง DB (1 request = 1 crawls row = 1 page, single-page flow) + HTML snapshot + CWV. */
  private async persist(
    projectId: number,
    result: CrawlResult,
    rawHtml: string | null,
  ): Promise<void> {
    const crawlId = await this.repo.createCrawl(projectId, 'api');
    try {
      const htmlStorageKey = await this.storage.putHtml({
        projectId,
        crawlId,
        urlHash: urlHash(result.finalUrl),
        html: rawHtml,
      });
      const cwv = await this.psi.cwv(result.finalUrl);
      const { pageId, snapshotId } = await this.repo.persistPage({
        crawlId,
        projectId,
        result,
        htmlStorageKey,
        cwv,
      });
      this.logger.log(
        `crawl#persist project=${projectId} crawl=${crawlId} page=${pageId} ` +
          `snapshot=${snapshotId} links=${result.links.length} images=${result.imageRows.length} ` +
          `html=${htmlStorageKey ? 'y' : 'n'} cwv=${cwv.lcpMs != null ? 'y' : 'n'}`,
      );
    } catch (err) {
      await this.repo.markFailed(crawlId).catch(() => undefined);
      throw err;
    }
  }

  /** ลิงก์ same-host + ไม่ใช่นามสกุล asset (น่าจะเป็นหน้า HTML) → ควรเดิน BFS ต่อ. */
  private isHtmlLikely(url: string, host: string): boolean {
    try {
      const u = new URL(url);
      if (u.host !== host) return false;
      return !NON_HTML_EXT.test(u.pathname);
    } catch {
      return false;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CrawlJobData>, err: Error) {
    this.logger.error(`crawl#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`crawl worker error: ${err.message}`);
  }
}
