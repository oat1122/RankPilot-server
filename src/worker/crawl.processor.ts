import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CrawlerService } from '../crawler/crawler.service';
import { CrawlerRepo } from '../crawler/crawler.repo';
import type { CrawlResult } from '../crawler/crawler.schema';

/** payload ของ queue 'crawl' — projectId optional (มี = persist ลง DB). */
type CrawlJobData = { url: string; projectId?: number };

/**
 * Consumer ของ queue 'crawl' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * คืนค่า CrawlResult → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET /crawls/:id.
 * ถ้า job มี projectId → persist pages/page_snapshots/page_links (เอกสาร 04 §7 step 2)
 * เป็น side-effect เพื่อป้อน input ให้ stage [3] Analysis (returnvalue ยังเป็น CrawlResult เดิม).
 */
@Processor('crawl')
export class CrawlProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlProcessor.name);

  constructor(
    private readonly crawler: CrawlerService,
    private readonly repo: CrawlerRepo,
  ) {
    super();
  }

  async process(job: Job<CrawlJobData>): Promise<CrawlResult> {
    this.logger.log(`crawl#${job.id} → ${job.data.url}`);
    const result = await this.crawler.crawl(job.data.url);
    this.logger.log(
      `crawl#${job.id} done status=${result.httpStatus} words=${result.wordCount} links=${result.links.length}`,
    );

    // persist เฉพาะเมื่อระบุ projectId — ให้ stage [3] Analysis มี input จริง (เอกสาร 04 §7)
    if (job.data.projectId != null)
      await this.persist(job.data.projectId, result);

    return result;
  }

  /** เขียนผล crawl ลง DB (1 request = 1 crawls row = 1 page ใน MVP single-URL). */
  private async persist(projectId: number, result: CrawlResult): Promise<void> {
    const crawlId = await this.repo.createCrawl(projectId, 'api');
    try {
      const pageId = await this.repo.upsertPage(projectId, result.url);
      const snapshotId = await this.repo.insertSnapshot({
        crawlId,
        pageId,
        result,
      });
      await this.repo.insertLinks(crawlId, projectId, pageId, result.links);
      await this.repo.finishCrawl(crawlId, {
        status: result.httpStatus >= 400 ? 'partial' : 'done',
        pagesDiscovered: 1,
        pagesCrawled: 1,
      });
      this.logger.log(
        `crawl#persist project=${projectId} crawl=${crawlId} page=${pageId} snapshot=${snapshotId} links=${result.links.length}`,
      );
    } catch (err) {
      // mark failed (best-effort) แล้ว rethrow ให้ BullMQ บันทึก fail — ไม่กลืน error เงียบ
      await this.repo
        .finishCrawl(crawlId, {
          status: 'failed',
          pagesDiscovered: 1,
          pagesCrawled: 0,
        })
        .catch(() => undefined);
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
