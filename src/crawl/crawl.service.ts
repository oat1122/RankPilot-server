import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { CreateCrawlDto } from './dto/create-crawl.dto';
import type { CrawlResult } from '../crawler/crawler.schema';
import { AppException, ErrorCode } from '../common/http';
import { withTimeout } from '../common/with-timeout';

/** payload + ผลของ queue 'crawl' — discriminated union: single-page (เดิม) | site crawl (ใหม่).
 *  single-page: {url, projectId?}; site: {mode:'site', projectId, maxPages} (BFS+sitemap ทั้งเว็บ). */
type PageCrawlJobData = { url: string; projectId?: number };
type SiteCrawlJobData = { mode: 'site'; projectId: number; maxPages: number };
type CrawlJobData = PageCrawlJobData | SiteCrawlJobData;
/** site crawl คืนสรุป (job.returnvalue) แทน CrawlResult; FE poll อ่านแค่ state. */
type SiteCrawlSummary = {
  crawlId: number;
  pagesDiscovered: number;
  pagesCrawled: number;
};
type CrawlQueue = Queue<CrawlJobData, CrawlResult | SiteCrawlSummary>;

/** throttle log queue 'error' — ioredis retry ถี่ตอน Redis ล่ม ไม่งั้น log ท่วม */
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;

/**
 * CrawlService (api side) — บางเฉียบตามกฎ api ≠ worker (เอกสาร 00 §4):
 * แค่ตั้งงานเข้า BullMQ 'crawl' แล้วตอบ jobId. การ crawl จริงทำใน worker process.
 */
@Injectable()
export class CrawlService implements OnModuleInit {
  private readonly logger = new Logger(CrawlService.name);
  private lastQueueErrorLogAt = 0;

  constructor(
    @InjectQueue('crawl') private readonly queue: CrawlQueue,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // ต้องมี listener 'error' มิฉะนั้น Redis ล่ม/ปิด connection → unhandled 'error' ล้มทั้ง process.
    // log ทั้ง name+code+message ∵ ioredis บาง error (เช่น ECONNREFUSED) มี code แต่ message ว่าง
    // (อาการเดิม: "crawl queue error:" โล่ง debug ไม่ได้) + throttle กัน log ท่วมตอน retry ถี่.
    this.queue.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS) return;
      this.lastQueueErrorLogAt = now;
      const code = (err as { code?: string }).code;
      const detail = [err.name, code, err.message].filter(Boolean).join(' ');
      this.logger.warn(
        `crawl queue error: ${detail || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
      );
    });
  }

  /** single-page crawl (POST /crawls) — เดิม. */
  enqueue(dto: CreateCrawlDto) {
    return this.add('crawl-url', { url: dto.url, projectId: dto.projectId });
  }

  /**
   * site crawl ทั้งเว็บ (POST /projects/:id/crawls) — worker discover sitemap+BFS แล้ว persist ทุกหน้า.
   * ปฏิเสธทันทีถ้า maxPages เกินเพดาน env CRAWLER_SITE_MAX_PAGES (single source of truth ตัวเดียวกับ
   * GET /config ที่ FE ใช้ตั้ง max ของ input) — เดิม worker clamp เงียบ ๆ ทำให้ค่าที่กรอกกับที่รันจริง
   * ไม่ตรง; ตรงนี้ตอบ VALIDATION_FAILED พร้อมบอกเพดานชัด ๆ (worker ยัง clamp ซ้ำเป็น defense).
   */
  enqueueSite(projectId: number, maxPages: number) {
    const cap = this.config.get<number>('CRAWLER_SITE_MAX_PAGES') ?? 200;
    if (maxPages > cap)
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `จำนวนหน้าสูงสุดเกินเพดาน — กำหนดได้สูงสุด ${cap} หน้า`,
        { maxPages, cap },
      );
    return this.add('site-crawl', { mode: 'site', projectId, maxPages });
  }

  /**
   * เพิ่ม job เข้า queue 'crawl' + ครอบ timeout — api แค่ตั้งงาน, worker (process แยก) ทำจริง (เอกสาร 00 §4).
   * ⚠️ ต้องมี worker รันอยู่ (`npm run start:worker:dev`) ไม่งั้น job ค้าง state=waiting ตลอด.
   * timeout ∵ ตอน Redis ล่ม queue.add() ค้าง (offline-queue) ไม่ reject เอง → ตอบ 503 เร็วแทนปล่อยค้าง.
   */
  private async add(name: string, data: CrawlJobData) {
    const timeoutMs =
      this.config.get<number>('QUEUE_ENQUEUE_TIMEOUT_MS') ?? 5000;
    try {
      const job = await withTimeout(this.queue.add(name, data), timeoutMs);
      return { jobId: job.id, status: 'queued' as const };
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`enqueue ${name} failed: ${reason}`);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ตั้งคิว crawl ไม่สำเร็จ (queue ไม่พร้อม) — โปรดลองใหม่อีกครั้ง',
      );
    }
  }

  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    // throw ด้วย code กลาง → FE ได้ error.code='CRAWL_JOB_NOT_FOUND' คงที่ (เอกสาร 04 §6)
    if (!job)
      throw new AppException(
        ErrorCode.CRAWL_JOB_NOT_FOUND,
        `crawl job ${jobId} not found`,
      );
    const state = await job.getState();
    return {
      jobId: job.id,
      url: 'url' in job.data ? (job.data.url ?? null) : null,
      state, // waiting | active | completed | failed | delayed
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }
}
