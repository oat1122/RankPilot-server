import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppException, ErrorCode } from '../common/http';
import { withTimeout } from '../common/with-timeout';
import { AnalysisRepo } from './analysis.repo';
import type { AnalyzeCrawlJobData, AnalysisSummary } from './analysis.runner';
import type {
  CreateAnalysisDto,
  ListFindingsQueryDto,
  ListScoresQueryDto,
} from './dto/create-analysis.dto';

type AnalysisQueue = Queue<AnalyzeCrawlJobData, AnalysisSummary>;

/** throttle log queue 'error' — ioredis retry ถี่ตอน Redis ล่ม ไม่งั้น log ท่วม. */
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;
/** default rows/หน้า ของ GET findings. */
const DEFAULT_FINDINGS_LIMIT = 50;

/**
 * AnalysisService (api side) — บางตามกฎ api ≠ worker (เอกสาร 00 §4): ตรวจ project แล้ว
 * ตั้งงานเข้า queue 'analysis'. การคำนวณจริงทำใน worker (AnalysisProcessor → AnalysisRunner).
 * นอกจาก enqueue/status ยังมี read endpoints (findings/scores) ให้ Dashboard อ่านผลตรงจาก DB.
 */
@Injectable()
export class AnalysisService implements OnModuleInit {
  private readonly logger = new Logger(AnalysisService.name);
  private lastQueueErrorLogAt = 0;

  constructor(
    @InjectQueue('analysis') private readonly queue: AnalysisQueue,
    private readonly config: ConfigService,
    private readonly repo: AnalysisRepo,
  ) {}

  onModuleInit() {
    // ต้องมี listener 'error' มิฉะนั้น Redis ล่ม → unhandled 'error' ล้มทั้ง process
    // (เหตุผลเดียวกับ EnrichService) + throttle กัน log ท่วมตอน retry ถี่.
    this.queue.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS) return;
      this.lastQueueErrorLogAt = now;
      const code = (err as { code?: string }).code;
      const detail = [err.name, code, err.message].filter(Boolean).join(' ');
      this.logger.warn(
        `analysis queue error: ${detail || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
      );
    });
  }

  /** enqueue analyze-crawl ของ project (crawlId optional → worker ใช้ crawl ล่าสุด). */
  async enqueue(projectId: number, dto: CreateAnalysisDto) {
    if (!(await this.repo.projectExists(projectId)))
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `project ${projectId} not found`,
      );

    const data: AnalyzeCrawlJobData = { projectId, crawlId: dto.crawlId };
    const timeoutMs =
      this.config.get<number>('QUEUE_ENQUEUE_TIMEOUT_MS') ?? 5000;
    try {
      const job = await withTimeout(
        this.queue.add('analyze-crawl', data),
        timeoutMs,
      );
      return { jobId: job.id, projectId, status: 'queued' as const };
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`enqueue analysis failed: ${reason}`);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ตั้งคิว analysis ไม่สำเร็จ (queue ไม่พร้อม) — โปรดลองใหม่อีกครั้ง',
      );
    }
  }

  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job)
      throw new AppException(
        ErrorCode.ANALYSIS_JOB_NOT_FOUND,
        `analysis job ${jobId} not found`,
      );
    const state = await job.getState();
    return {
      jobId: job.id,
      name: job.name, // 'analyze-crawl'
      state,
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }

  /** findings ของ project เรียงตาม impact (สูง→ต่ำ) + total สำหรับ pagination. */
  async findings(projectId: number, query: ListFindingsQueryDto) {
    const limit = query.limit ?? DEFAULT_FINDINGS_LIMIT;
    const offset = query.offset ?? 0;
    const { items, total } = await this.repo.listFindings(projectId, {
      status: query.status,
      type: query.type,
      limit,
      offset,
    });
    return { items, total, limit, offset };
  }

  /** seo_scores ของ crawl ที่เลือก/ล่าสุด. */
  async scores(projectId: number, query: ListScoresQueryDto) {
    const items = await this.repo.listScores(projectId, query.crawlId);
    return { items };
  }
}
