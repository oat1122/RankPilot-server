import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CrawlerService } from '../crawler/crawler.service';
import { CrawlerRepo } from '../crawler/crawler.repo';
import type { CrawlResult } from '../crawler/crawler.schema';
import { HtmlStorageService } from '../storage/html-storage.service';
import { PsiService } from '../psi/psi.service';
import { urlHash } from '../common/url';

/** payload ของ queue 'crawl' — projectId optional (มี = persist ลง DB). */
type CrawlJobData = { url: string; projectId?: number };

/**
 * Consumer ของ queue 'crawl' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * คืนค่า CrawlResult → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET /crawls/:id.
 * ถ้า job มี projectId → persist pages/page_snapshots/page_links/page_images (เอกสาร 04 §7
 * step 2) + เก็บ raw HTML (gzip) ลง disk + ดึง CWV จาก PSI เป็น side-effect เพื่อป้อน stage [3]
 * Analysis (returnvalue ยังเป็น CrawlResult เดิม). raw HTML ไม่อยู่ใน returnvalue (ลง disk เท่านั้น).
 */
@Processor('crawl')
export class CrawlProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlProcessor.name);

  constructor(
    private readonly crawler: CrawlerService,
    private readonly repo: CrawlerRepo,
    private readonly storage: HtmlStorageService,
    private readonly psi: PsiService,
  ) {
    super();
  }

  async process(job: Job<CrawlJobData>): Promise<CrawlResult> {
    this.logger.log(`crawl#${job.id} → ${job.data.url}`);
    const { result, rawHtml } = await this.crawler.crawl(job.data.url);
    this.logger.log(
      `crawl#${job.id} done status=${result.httpStatus} words=${result.wordCount} links=${result.links.length} images=${result.images.total}`,
    );

    // persist เฉพาะเมื่อระบุ projectId — ให้ stage [3] Analysis มี input จริง (เอกสาร 04 §7)
    if (job.data.projectId != null)
      await this.persist(job.data.projectId, result, rawHtml);

    return result;
  }

  /** เขียนผล crawl ลง DB (1 request = 1 crawls row = 1 page ใน MVP single-URL) + HTML snapshot + CWV. */
  private async persist(
    projectId: number,
    result: CrawlResult,
    rawHtml: string | null,
  ): Promise<void> {
    const crawlId = await this.repo.createCrawl(projectId, 'api');
    try {
      // storage + PSI เป็น best-effort (คืน null เอง ไม่ throw) — ทำนอก transaction ของ persistPage.
      // storage key ต้องใช้ crawlId → ∴ createCrawl ก่อนเขียนไฟล์.
      const htmlStorageKey = await this.storage.putHtml({
        projectId,
        crawlId,
        urlHash: urlHash(result.url),
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
      // mark failed (best-effort) แล้ว rethrow ให้ BullMQ บันทึก fail — ไม่กลืน error เงียบ
      await this.repo.markFailed(crawlId).catch(() => undefined);
      throw err;
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
