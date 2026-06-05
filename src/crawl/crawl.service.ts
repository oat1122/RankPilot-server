import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { CreateCrawlDto } from './dto/create-crawl.dto';
import type { CrawlResult } from '../crawler/crawler.schema';

/** payload + ผลของ queue 'crawl' — typed เพื่อให้ job.data/returnvalue ไม่เป็น any */
type CrawlJobData = { url: string };
type CrawlQueue = Queue<CrawlJobData, CrawlResult>;

/**
 * CrawlService (api side) — บางเฉียบตามกฎ api ≠ worker (เอกสาร 00 §4):
 * แค่ตั้งงานเข้า BullMQ 'crawl' แล้วตอบ jobId. การ crawl จริงทำใน worker process.
 */
@Injectable()
export class CrawlService implements OnModuleInit {
  private readonly logger = new Logger(CrawlService.name);

  constructor(@InjectQueue('crawl') private readonly queue: CrawlQueue) {}

  onModuleInit() {
    // ต้องมี listener 'error' มิฉะนั้น Redis ล่ม/ปิด connection → unhandled 'error' ล้มทั้ง process
    this.queue.on('error', (err) =>
      this.logger.warn(`crawl queue error: ${err.message}`),
    );
  }

  async enqueue(dto: CreateCrawlDto) {
    const job = await this.queue.add('crawl-url', { url: dto.url });
    return { jobId: job.id, status: 'queued' as const };
  }

  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`crawl job ${jobId} not found`);
    const state = await job.getState();
    return {
      jobId: job.id,
      url: job.data.url ?? null,
      state, // waiting | active | completed | failed | delayed
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }
}
