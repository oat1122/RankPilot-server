import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CrawlerService } from '../crawler/crawler.service';
import type { CrawlResult } from '../crawler/crawler.schema';

/**
 * Consumer ของ queue 'crawl' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * คืนค่า CrawlResult → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET /crawls/:id.
 */
@Processor('crawl')
export class CrawlProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlProcessor.name);

  constructor(private readonly crawler: CrawlerService) {
    super();
  }

  async process(job: Job<{ url: string }>): Promise<CrawlResult> {
    this.logger.log(`crawl#${job.id} → ${job.data.url}`);
    const result = await this.crawler.crawl(job.data.url);
    this.logger.log(
      `crawl#${job.id} done status=${result.httpStatus} words=${result.wordCount} links=${result.links.length}`,
    );
    return result;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ url: string }>, err: Error) {
    this.logger.error(`crawl#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`crawl worker error: ${err.message}`);
  }
}
