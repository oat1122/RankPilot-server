import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppException, ErrorCode } from '../common/http';
import { withTimeout } from '../common/with-timeout';
import { AhrefsRepo } from '../ahrefs/ahrefs.repo';
import { BudgetGuard } from '../ahrefs/budget.guard';
import { currentPeriod } from '../ahrefs/period';
import type {
  EnrichOrganicJobData,
  EnrichmentSummary,
} from '../ahrefs/enrichment.service';
import type { CreateEnrichDto } from './dto/create-enrich.dto';

type EnrichQueue = Queue<EnrichOrganicJobData, EnrichmentSummary>;

/** throttle log queue 'error' — ioredis retry ถี่ตอน Redis ล่ม ไม่งั้น log ท่วม */
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;
/** default rows/request — Lite จริง ~10 rows (เอกสาร 03 §0) */
const DEFAULT_LIMIT = 10;

/**
 * EnrichService (api side) — บางตามกฎ api ≠ worker (เอกสาร 00 §4): โหลด project,
 * resolve country/cap แล้วตั้งงานเข้า queue 'ahrefs'. การยิง Ahrefs จริงทำใน worker.
 */
@Injectable()
export class EnrichService implements OnModuleInit {
  private readonly logger = new Logger(EnrichService.name);
  private lastQueueErrorLogAt = 0;

  constructor(
    @InjectQueue('ahrefs') private readonly queue: EnrichQueue,
    private readonly config: ConfigService,
    private readonly repo: AhrefsRepo,
    private readonly budget: BudgetGuard,
  ) {}

  onModuleInit() {
    // ต้องมี listener 'error' มิฉะนั้น Redis ล่ม → unhandled 'error' ล้มทั้ง process
    // (เหตุผลเดียวกับ CrawlService) + throttle กัน log ท่วมตอน retry ถี่.
    this.queue.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS) return;
      this.lastQueueErrorLogAt = now;
      const code = (err as { code?: string }).code;
      const detail = [err.name, code, err.message].filter(Boolean).join(' ');
      this.logger.warn(
        `ahrefs queue error: ${detail || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
      );
    });
  }

  async enqueue(projectId: number, dto: CreateEnrichDto) {
    const project = await this.repo.getProject(projectId);
    if (!project) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `project ${projectId} not found`,
      );
    }
    const country =
      dto.country ??
      project.country ??
      this.config.get<string>('AHREFS_DEFAULT_COUNTRY')!;
    const cap =
      project.monthlyUnitBudget ??
      this.config.get<number>('AHREFS_MONTHLY_UNIT_BUDGET')!;
    const data: EnrichOrganicJobData = {
      projectId,
      domain: project.domain,
      country,
      limit: dto.limit ?? DEFAULT_LIMIT,
      cap,
    };

    // ครอบ timeout ∵ ตอน Redis ล่ม queue.add() ค้าง (offline-queue) ไม่ reject เอง →
    // ตอบ 503 เร็ว ๆ แทนปล่อย request ค้างจน client abort.
    const timeoutMs =
      this.config.get<number>('QUEUE_ENQUEUE_TIMEOUT_MS') ?? 5000;
    try {
      const job = await withTimeout(
        this.queue.add('enrich-organic', data),
        timeoutMs,
      );
      return { jobId: job.id, projectId, status: 'queued' as const };
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`enqueue ahrefs failed: ${reason}`);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ตั้งคิว Ahrefs enrichment ไม่สำเร็จ (queue ไม่พร้อม) — โปรดลองใหม่อีกครั้ง',
      );
    }
  }

  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job)
      throw new AppException(
        ErrorCode.AHREFS_JOB_NOT_FOUND,
        `ahrefs job ${jobId} not found`,
      );
    const state = await job.getState();
    return {
      jobId: job.id,
      state, // waiting | active | completed | failed | delayed
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }

  async budgetStatus(projectId: number) {
    const project = await this.repo.getProject(projectId);
    if (!project) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `project ${projectId} not found`,
      );
    }
    const period = currentPeriod();
    const cap =
      project.monthlyUnitBudget ??
      this.config.get<number>('AHREFS_MONTHLY_UNIT_BUDGET')!;
    const unitsSpent = await this.budget.spent(projectId, period);
    return {
      projectId,
      period,
      unitsSpent,
      cap,
      remaining: Math.max(cap - unitsSpent, 0),
    };
  }
}
