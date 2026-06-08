import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppException, ErrorCode } from '../common/http';
import { withTimeout } from '../common/with-timeout';
import { AiRepo } from './ai.repo';
import type { PageAuditJobData, PageAuditSummary } from './ai.runner';
import type {
  CreateAiAuditDto,
  ListRecommendationsQueryDto,
} from './dto/create-ai-audit.dto';

type AiQueue = Queue<PageAuditJobData, PageAuditSummary>;

/** throttle log queue 'error' — ioredis retry ถี่ตอน Redis ล่ม ไม่งั้น log ท่วม. */
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;
/** default rows/หน้า ของ GET recommendations. */
const DEFAULT_RECS_LIMIT = 50;

/**
 * AiService (api side) — บางตามกฎ api ≠ worker (เอกสาร 00 §4): ตรวจ project, resolve
 * crawl/pages แล้วตั้งงานเข้า queue 'ai' (1 job/เพจ). การยิง LLM จริงทำใน worker
 * (AiProcessor → AiRunner). นอกจาก enqueue/status ยังมี read endpoint (recommendations).
 */
@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private lastQueueErrorLogAt = 0;

  constructor(
    @InjectQueue('ai') private readonly queue: AiQueue,
    private readonly config: ConfigService,
    private readonly repo: AiRepo,
  ) {}

  onModuleInit() {
    // ต้องมี listener 'error' มิฉะนั้น Redis ล่ม → unhandled 'error' ล้มทั้ง process
    // (เหตุผลเดียวกับ AnalysisService) + throttle กัน log ท่วมตอน retry ถี่.
    this.queue.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS) return;
      this.lastQueueErrorLogAt = now;
      const code = (err as { code?: string }).code;
      const detail = [err.name, code, err.message].filter(Boolean).join(' ');
      this.logger.warn(
        `ai queue error: ${detail || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
      );
    });
  }

  /**
   * enqueue page-audit: ไม่ระบุ crawlId → crawl ล่าสุด; ไม่ระบุ pageId → ทุกเพจของ crawl
   * (1 job/เพจ ผ่าน addBulk). ตรวจ projectExists ก่อน + withTimeout (ตอบ 503 ถ้า queue ไม่พร้อม).
   */
  async enqueue(projectId: number, dto: CreateAiAuditDto) {
    if (!(await this.repo.projectExists(projectId)))
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `project ${projectId} not found`,
      );

    const crawlId = dto.crawlId ?? (await this.repo.latestCrawlId(projectId));
    if (crawlId == null)
      throw new AppException(
        ErrorCode.AI_NO_CRAWL,
        `project ${projectId} ยังไม่มี crawl ให้วิเคราะห์ (ต้อง crawl ก่อน)`,
      );

    const pageIds = dto.pageId
      ? [dto.pageId]
      : await this.repo.pageIdsForCrawl(crawlId);
    if (pageIds.length === 0)
      throw new AppException(
        ErrorCode.AI_NO_CRAWL,
        `crawl ${crawlId} ไม่มีหน้าให้วิเคราะห์ (crawl ยังไม่เสร็จ/ล้ม หรือ crawlId ไม่ถูกต้อง)`,
      );

    const jobs = pageIds.map((pageId) => ({
      name: 'audit-page',
      data: { projectId, pageId, crawlId } satisfies PageAuditJobData,
    }));

    const timeoutMs =
      this.config.get<number>('QUEUE_ENQUEUE_TIMEOUT_MS') ?? 5000;
    try {
      const added = await withTimeout(this.queue.addBulk(jobs), timeoutMs);
      return {
        projectId,
        crawlId,
        enqueued: added.length,
        jobIds: added.map((j) => j.id).filter((id): id is string => !!id),
        status: 'queued' as const,
      };
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`enqueue ai failed: ${reason}`);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ตั้งคิว AI ไม่สำเร็จ (queue ไม่พร้อม) — โปรดลองใหม่อีกครั้ง',
      );
    }
  }

  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job)
      throw new AppException(
        ErrorCode.AI_JOB_NOT_FOUND,
        `ai job ${jobId} not found`,
      );
    const state = await job.getState();
    return {
      jobId: job.id,
      name: job.name, // 'audit-page'
      state,
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }

  /** ai_recommendations ของ project (filter + pagination) สำหรับ Dashboard. */
  async recommendations(projectId: number, query: ListRecommendationsQueryDto) {
    const limit = query.limit ?? DEFAULT_RECS_LIMIT;
    const offset = query.offset ?? 0;
    const { items, total } = await this.repo.listRecommendations(projectId, {
      pageId: query.pageId,
      type: query.type,
      status: query.status,
      limit,
      offset,
    });
    return { items, total, limit, offset };
  }
}
